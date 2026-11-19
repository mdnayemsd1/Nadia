// Telegram order notifications. The bot token is read from a Cloudflare secret
// (TELEGRAM_BOT_TOKEN) and is never logged, stored or returned.

import { selectRows, patchRows } from './supabase.js';

export const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const money = (n) => '৳' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

const PAYMENT_LABEL = { bkash: 'bKash', nagad: 'Nagad', cod: 'Cash on Delivery' };

export function formatOrderMessage(order) {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(order.created_at));

  const items = (order.order_items || [])
    .map(
      (it, i) =>
        `${i + 1}. ${escapeHtml(it.product_name)} × ${it.quantity}\n    ${money(it.unit_price)} each = <b>${money(it.total_price)}</b>`,
    )
    .join('\n');

  const manual = order.payment_method === 'bkash' || order.payment_method === 'nagad';
  const payment =
    `💳 <b>Payment:</b> ${PAYMENT_LABEL[order.payment_method] || escapeHtml(order.payment_method)}` +
    (manual
      ? `\n🔖 <b>Transaction ID:</b> <code>${escapeHtml(order.transaction_reference || '-')}</code>\n⚠️ <i>Not verified — please verify manually</i>`
      : '');

  const lines = [
    `🛒 <b>New Order</b> — <code>${escapeHtml(order.order_number)}</code>`,
    `🕒 ${escapeHtml(when)} (Dhaka)`,
    '',
    `👤 <b>${escapeHtml(order.customer_name)}</b>`,
    `📞 <code>${escapeHtml(order.phone)}</code>`,
    `📍 ${escapeHtml(order.address)}, ${escapeHtml(order.district)}`,
    '',
    '<b>Items</b>',
    items,
    '',
    `Subtotal: ${money(order.subtotal)}`,
    `Delivery: ${money(order.delivery_charge)}`,
    `<b>Total: ${money(order.total)}</b>`,
    '',
    payment,
  ];
  if (order.notes) lines.push('', `📝 <b>Notes:</b> ${escapeHtml(String(order.notes).slice(0, 500))}`);
  lines.push('', `Status: <b>${escapeHtml(order.status)}</b>`);

  let text = lines.join('\n');
  if (text.length > 4000) text = text.slice(0, 3990) + '…';
  return text;
}

/** Remove anything resembling the bot token from error text before it is stored. */
function scrub(message, token) {
  let m = String(message || 'Unknown error');
  if (token) m = m.split(token).join('***');
  return m.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***').slice(0, 300);
}

export async function sendTelegram(cfg, text, fetchImpl = fetch) {
  if (!cfg.tgToken || !cfg.tgChat) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${cfg.tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.tgChat,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* non-JSON response */
    }
    // Only a response with ok:true from Telegram counts as delivered.
    if (res.ok && data && data.ok === true) return { ok: true };
    return { ok: false, error: scrub(data?.description || `HTTP ${res.status}`, cfg.tgToken) };
  } catch (e) {
    return { ok: false, error: scrub(e?.name === 'AbortError' ? 'Telegram request timed out' : e?.message, cfg.tgToken) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads the order, sends the Telegram message, records the outcome.
 * @returns {{ status: 'sent'|'failed', error?: string }}
 */
export async function notifyOrder(cfg, orderId, fetchImpl = fetch) {
  const rows = await selectRows(cfg, `orders?id=eq.${orderId}&select=*,order_items(*)`);
  const order = rows?.[0];
  if (!order) return { status: 'failed', error: 'ORDER_NOT_FOUND' };

  const result = await sendTelegram(cfg, formatOrderMessage(order), fetchImpl);
  try {
    await patchRows(
      cfg,
      `orders?id=eq.${orderId}`,
      result.ok
        ? { telegram_status: 'sent', telegram_error: null, telegram_sent_at: new Date().toISOString() }
        : { telegram_status: 'failed', telegram_error: result.error },
    );
  } catch (e) {
    console.error('Could not record Telegram status:', e?.message);
  }
  return result.ok ? { status: 'sent' } : { status: 'failed', error: result.error };
}
