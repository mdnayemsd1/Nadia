// Unit / integration tests for the Cloudflare Functions. Supabase and Telegram are MOCKED
// (no network): these verify our logic, not the live services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrder, normalizePhone } from '../functions/_lib/validate.js';
import { formatOrderMessage, escapeHtml, sendTelegram } from '../functions/_lib/telegram.js';
import { onRequestPost as orderPost } from '../functions/api/order.js';
import { onRequestGet as configGet } from '../functions/api/config.js';
import { onRequestGet as healthGet } from '../functions/api/health.js';
import { onRequestPost as retryPost } from '../functions/api/retry-telegram.js';

const PID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  TELEGRAM_BOT_TOKEN: '7809248639:SECRET_TOKEN_VALUE', TELEGRAM_CHAT_ID: '12345',
};
const goodBody = (over = {}) => ({
  customer: { name: 'Rahim Uddin', phone: '01712345678', address: 'House 5, Road 3, Dhanmondi', district: 'Dhaka', notes: '' },
  paymentMethod: 'cod', transactionReference: '', items: [{ id: PID, qty: 2 }], idempotencyKey: 'abcdefgh-1234', lang: 'en', ...over,
});

/* ---------- validation ---------- */
test('phone normalization accepts BD formats and rejects others', () => {
  assert.equal(normalizePhone('01712345678'), '01712345678');
  assert.equal(normalizePhone('+8801712345678'), '01712345678');
  assert.equal(normalizePhone('8801712345678'), '01712345678');
  assert.equal(normalizePhone('০১৭১২৩৪৫৬৭৮'), '01712345678'); // Bangla digits
  assert.equal(normalizePhone('01 7123-45678'), '01712345678');
  assert.equal(normalizePhone('01212345678'), null); // 012 is not a mobile prefix
  assert.equal(normalizePhone('0171234567'), null);
  assert.equal(normalizePhone('abc'), null);
});
test('valid order passes; browser-supplied prices are ignored', () => {
  const r = validateOrder(goodBody({ items: [{ id: PID, qty: 2, price: 1 }], total: 1 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.items, [{ id: PID, qty: 2 }]); // only id+qty survive
  assert.equal(JSON.stringify(r.data).includes('"price"'), false);
});
test('duplicate product lines are merged', () => {
  const r = validateOrder(goodBody({ items: [{ id: PID, qty: 2 }, { id: PID, qty: 3 }] }));
  assert.deepEqual(r.data.items, [{ id: PID, qty: 5 }]);
});
test('invalid inputs are rejected with field codes', () => {
  const r = validateOrder({ customer: { name: 'A', phone: '123', address: 'short', district: 'Mars' }, paymentMethod: 'bitcoin', items: [{ id: 'x', qty: 0 }], idempotencyKey: 'k' });
  assert.equal(r.ok, false);
  for (const k of ['name', 'phone', 'address', 'district', 'paymentMethod', 'items', 'idempotencyKey']) assert.ok(r.errors[k], k);
});
test('bKash/Nagad require a transaction id; COD does not', () => {
  assert.equal(validateOrder(goodBody({ paymentMethod: 'bkash', transactionReference: '' })).errors.transactionReference, 'TRX_INVALID');
  assert.equal(validateOrder(goodBody({ paymentMethod: 'nagad', transactionReference: '9ab3c4d5ef' })).data.customer.transaction_reference, '9AB3C4D5EF');
  assert.equal(validateOrder(goodBody({ paymentMethod: 'cod' })).ok, true);
});
test('quantity limits and item count limits', () => {
  assert.equal(validateOrder(goodBody({ items: [{ id: PID, qty: 21 }] })).ok, false);
  assert.equal(validateOrder(goodBody({ items: [] })).ok, false);
  assert.equal(validateOrder(goodBody({ items: [{ id: PID, qty: 1.5 }] })).ok, false);
});

/* ---------- telegram ---------- */
const sampleOrder = {
  order_number: 'NGH-261119-1001', created_at: '2026-11-19T03:00:00Z', customer_name: '<b>Evil</b> & Co', phone: '01712345678',
  address: 'House <5>', district: 'Dhaka', notes: 'call me <script>', payment_method: 'bkash', transaction_reference: '9AB3C4D5EF',
  subtotal: 4980, delivery_charge: 70, total: 5050, status: 'pending',
  order_items: [{ product_name: 'Earbuds <X>', quantity: 2, unit_price: 2490, total_price: 4980 }],
};
test('telegram message contains all required fields and escapes HTML', () => {
  const m = formatOrderMessage(sampleOrder);
  for (const s of ['NGH-261119-1001', '01712345678', 'Dhaka', '× 2', '৳2,490', '৳4,980', '৳70', '৳5,050', 'bKash', '9AB3C4D5EF', 'pending', 'Dhaka)']) assert.ok(m.includes(s), s);
  assert.ok(!m.includes('<script>') && !m.includes('<b>Evil</b>'));
  assert.ok(m.includes('&lt;b&gt;Evil&lt;/b&gt; &amp; Co'));
  assert.equal(escapeHtml('<&>'), '&lt;&amp;&gt;');
});
test('sendTelegram: success only when Telegram says ok:true', async () => {
  const cfg = { tgToken: 'TOKEN', tgChat: '1' };
  const ok = await sendTelegram(cfg, 'hi', async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assert.equal(ok.ok, true);
  const bad200 = await sendTelegram(cfg, 'hi', async () => new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 200 }));
  assert.equal(bad200.ok, false);
  const http400 = await sendTelegram(cfg, 'hi', async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 }));
  assert.equal(http400.ok, false);
  const boom = await sendTelegram(cfg, 'hi', async () => { throw new Error('network down at https://api.telegram.org/botTOKEN/sendMessage'); });
  assert.equal(boom.ok, false);
  assert.ok(!boom.error.includes('TOKEN'), 'token must be scrubbed from errors');
  const missing = await sendTelegram({ tgToken: '', tgChat: '' }, 'hi');
  assert.equal(missing.error, 'TELEGRAM_NOT_CONFIGURED');
});

/* ---------- /api/order with mocked Supabase + Telegram ---------- */
function mockWorld({ telegramOk = true, rpcError = null, duplicate = false } = {}) {
  const calls = { telegram: [], patches: [], rpc: [] };
  const orderRow = { id: 'o-1', ...sampleOrder, payment_method: 'cod', transaction_reference: null, telegram_status: 'pending' };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/create_order')) {
      const body = JSON.parse(init.body); calls.rpc.push(body);
      if (rpcError) return new Response(JSON.stringify({ message: rpcError }), { status: 400 });
      return new Response(JSON.stringify(duplicate
        ? { duplicate: true, order_id: 'o-1', order_number: 'NGH-261119-1001' }
        : { duplicate: false, order_id: 'o-1', order_number: 'NGH-261119-1001', subtotal: 4980, delivery_charge: 70, total: 5050 }), { status: 200 });
    }
    if (u.includes('/rest/v1/orders') && (init.method || 'GET') === 'GET') return new Response(JSON.stringify([orderRow]), { status: 200 });
    if (u.includes('/rest/v1/orders') && init.method === 'PATCH') { calls.patches.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    if (u.startsWith('https://api.telegram.org/')) {
      calls.telegram.push({ url: u, body: JSON.parse(init.body) });
      return telegramOk ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked' }), { status: 403 });
    }
    throw new Error('unexpected fetch ' + u);
  };
  return calls;
}
const req = (body, headers = {}) => new Request('https://shop.example/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example', ...headers }, body: JSON.stringify(body) });

test('order success: prices come from the server RPC, Telegram sent, status recorded', async () => {
  const calls = mockWorld();
  const res = await orderPost({ request: req(goodBody({ total: 1, items: [{ id: PID, qty: 2, price: 1 }] })), env: ENV });
  const j = await res.json();
  assert.equal(res.status, 201); assert.equal(j.ok, true); assert.equal(j.telegram, 'sent');
  assert.equal(j.order.total, 5050);
  assert.equal(JSON.stringify(calls.rpc[0].p_items), JSON.stringify([{ id: PID, qty: 2 }])); // no browser prices reach the DB layer
  assert.equal(calls.telegram.length, 1);
  assert.ok(calls.telegram[0].url.includes(ENV.TELEGRAM_BOT_TOKEN)); // token used server-side only
  assert.equal(calls.patches[0].telegram_status, 'sent');
  assert.ok(!JSON.stringify(j).includes('SECRET_TOKEN_VALUE'), 'token must never appear in responses');
});
test('order saved but Telegram fails → telegram:"failed", order preserved, never reported as sent', async () => {
  const calls = mockWorld({ telegramOk: false });
  const res = await orderPost({ request: req(goodBody()), env: ENV });
  const j = await res.json();
  assert.equal(res.status, 201); assert.equal(j.ok, true); assert.equal(j.telegram, 'failed');
  assert.equal(calls.patches[0].telegram_status, 'failed');
  assert.ok(calls.patches[0].telegram_error.includes('blocked'));
  assert.ok(!JSON.stringify(j).includes('SECRET_TOKEN_VALUE'));
});
test('Telegram not configured → order saved, status failed', async () => {
  mockWorld();
  const j = await (await orderPost({ request: req(goodBody()), env: { ...ENV, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' } })).json();
  assert.equal(j.ok, true); assert.equal(j.telegram, 'failed');
});
test('duplicate submission returns the same order and does not notify again when already sent', async () => {
  const calls = mockWorld({ duplicate: true });
  // existing order already marked sent
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => (String(url).includes('select=order_number') ? new Response(JSON.stringify([{ order_number: 'NGH-261119-1001', subtotal: 4980, delivery_charge: 70, total: 5050, telegram_status: 'sent' }]), { status: 200 }) : orig(url, init));
  const j = await (await orderPost({ request: req(goodBody()), env: ENV })).json();
  assert.equal(j.duplicate, true); assert.equal(j.telegram, 'sent'); assert.equal(calls.telegram.length, 0);
});
test('out-of-stock and rate-limit errors map to proper statuses', async () => {
  mockWorld({ rpcError: `OUT_OF_STOCK|${PID}|Earbuds|1` });
  let res = await orderPost({ request: req(goodBody()), env: ENV }); let j = await res.json();
  assert.equal(res.status, 409); assert.equal(j.error, 'OUT_OF_STOCK'); assert.equal(j.available, 1);
  mockWorld({ rpcError: 'RATE_LIMITED' });
  res = await orderPost({ request: req(goodBody()), env: ENV }); assert.equal(res.status, 429);
});
test('validation failure returns 422 and never reaches Supabase', async () => {
  const calls = mockWorld();
  const res = await orderPost({ request: req(goodBody({ customer: { name: '', phone: 'x', address: '', district: '' } })), env: ENV });
  assert.equal(res.status, 422); assert.equal(calls.rpc.length, 0);
});
test('honeypot, cross-origin, wrong content-type and oversize payloads are rejected', async () => {
  const calls = mockWorld();
  assert.equal((await orderPost({ request: req(goodBody({ website: 'http://spam' })), env: ENV })).status, 400);
  assert.equal((await orderPost({ request: req(goodBody(), { Origin: 'https://evil.example' }), env: ENV })).status, 403);
  assert.equal((await orderPost({ request: new Request('https://shop.example/api/order', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }), env: ENV })).status, 415);
  assert.equal((await orderPost({ request: new Request('https://shop.example/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(30000) }) }), env: ENV })).status, 413);
  assert.equal(calls.rpc.length, 0);
});
test('missing server configuration yields 503 (not a crash)', async () => {
  const res = await orderPost({ request: req(goodBody()), env: {} });
  assert.equal(res.status, 503);
});

/* ---------- config / health / retry ---------- */
test('/api/config exposes only the public URL and anon key', async () => {
  const j = await (await configGet({ env: ENV })).json();
  assert.deepEqual(Object.keys(j).sort(), ['ok', 'supabaseAnonKey', 'supabaseUrl']);
  const s = JSON.stringify(j); assert.ok(!s.includes('service') || j.supabaseAnonKey === 'anon'); assert.ok(!s.includes('SECRET_TOKEN_VALUE'));
  assert.equal((await configGet({ env: {} })).status, 503);
});
test('/api/health reports booleans only', async () => {
  const j = await (await healthGet({ env: ENV })).json();
  assert.equal(j.ok, true); for (const v of Object.values(j.checks)) assert.equal(typeof v, 'boolean');
  assert.ok(!JSON.stringify(j).includes('SECRET_TOKEN_VALUE'));
  assert.equal((await (await healthGet({ env: { ...ENV, TELEGRAM_BOT_TOKEN: '' } })).json()).ok, false);
});
test('retry-telegram requires a valid staff token', async () => {
  const mk = (h = {}) => new Request('https://shop.example/api/retry-telegram', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example', ...h }, body: JSON.stringify({ order_id: '22222222-2222-4222-8222-222222222222' }) });
  mockWorld();
  assert.equal((await retryPost({ request: mk(), env: ENV })).status, 401); // no token
  // token rejected by Supabase auth
  globalThis.fetch = async (u) => (String(u).includes('/auth/v1/user') ? new Response('{}', { status: 401 }) : new Response('[]'));
  assert.equal((await retryPost({ request: mk({ Authorization: 'Bearer bad' }), env: ENV })).status, 401);
  // valid user but not in admin_users
  globalThis.fetch = async (u) => (String(u).includes('/auth/v1/user') ? new Response(JSON.stringify({ id: '33333333-3333-4333-8333-333333333333' }), { status: 200 }) : new Response('[]', { status: 200 }));
  assert.equal((await retryPost({ request: mk({ Authorization: 'Bearer ok' }), env: ENV })).status, 403);
  // valid staff → retries and reports Telegram result
  const calls = mockWorld();
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i = {}) => {
    const s = String(u);
    if (s.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: '33333333-3333-4333-8333-333333333333' }), { status: 200 });
    if (s.includes('/rest/v1/admin_users')) return new Response(JSON.stringify([{ user_id: 'x', role: 'owner' }]), { status: 200 });
    return orig(u, i);
  };
  const j = await (await retryPost({ request: mk({ Authorization: 'Bearer good' }), env: ENV })).json();
  assert.equal(j.ok, true); assert.equal(j.telegram, 'sent'); assert.equal(calls.telegram.length, 1);
});
