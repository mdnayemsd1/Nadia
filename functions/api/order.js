// POST /api/order — create an order, then notify the store owner on Telegram.

import { HttpError, json, errorResponse, assertSameOrigin, readJson, ipHash } from '../_lib/http.js';
import { validateOrder } from '../_lib/validate.js';
import { readConfig, rpc, selectRows } from '../_lib/supabase.js';
import { notifyOrder } from '../_lib/telegram.js';

function mapRpcError(err) {
  const msg = String(err?.pg?.message || err?.message || '');
  const [code, a, b, c] = msg.split('|');
  switch (code) {
    case 'RATE_LIMITED':
      return new HttpError(429, 'RATE_LIMITED');
    case 'OUT_OF_STOCK':
      return new HttpError(409, 'OUT_OF_STOCK', { productId: a, productName: b, available: Number(c) || 0 });
    case 'PRODUCT_NOT_FOUND':
      return new HttpError(409, 'PRODUCT_NOT_FOUND', { productId: a });
    case 'INVALID_ITEMS':
    case 'INVALID_QTY':
    case 'INVALID_KEY':
      return new HttpError(422, 'VALIDATION', { fields: { items: 'ITEMS_INVALID' } });
    default:
      console.error('create_order failed:', msg.slice(0, 300));
      return new HttpError(500, 'SERVER_ERROR');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const cfg = readConfig(env);
    if (!cfg.url || !cfg.service) throw new HttpError(503, 'SERVER_NOT_CONFIGURED');

    assertSameOrigin(request);
    const body = await readJson(request);

    // Honeypot: real users never fill this hidden field.
    if (body.website) throw new HttpError(400, 'REJECTED');

    const v = validateOrder(body);
    if (!v.ok) throw new HttpError(422, 'VALIDATION', { fields: v.errors });

    let result;
    try {
      result = await rpc(cfg, 'create_order', {
        p_customer: v.data.customer,
        p_items: v.data.items,
        p_key: v.data.key,
        p_ip_hash: await ipHash(request, env),
      });
    } catch (e) {
      throw mapRpcError(e);
    }

    // Duplicate submission → return the original order; retry Telegram only if it never succeeded.
    if (result.duplicate) {
      const rows = await selectRows(
        cfg,
        `orders?id=eq.${result.order_id}&select=order_number,subtotal,delivery_charge,total,telegram_status`,
      );
      const o = rows?.[0];
      let telegram = o?.telegram_status === 'sent' ? 'sent' : 'failed';
      if (o && o.telegram_status !== 'sent') telegram = (await notifyOrder(cfg, result.order_id)).status;
      return json({
        ok: true,
        duplicate: true,
        order: {
          number: result.order_number,
          subtotal: o?.subtotal,
          deliveryCharge: o?.delivery_charge,
          total: o?.total,
        },
        telegram,
      });
    }

    const tg = await notifyOrder(cfg, result.order_id);

    return json(
      {
        ok: true,
        duplicate: false,
        order: {
          number: result.order_number,
          subtotal: result.subtotal,
          deliveryCharge: result.delivery_charge,
          total: result.total,
        },
        // 'sent' only when Telegram confirmed delivery; otherwise 'failed' (order is still saved).
        telegram: tg.status,
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequest({ request }) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
}
