// Browser end-to-end test of the ADMIN panel against an in-memory FAKE of supabase-js
// (served in place of the CDN module). It exercises our admin code paths — it does NOT prove
// that real Supabase Auth/RLS/Storage accept the calls (RLS is covered by tests/sql instead).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, '../../public');
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (_) { ({ chromium } = createRequire('/opt/npm-tools/node_modules/x.js')('playwright')); }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const FAKE_SUPABASE = `
const USERS = { 'owner@x': { id: 'u-owner', pw: 'pw' }, 'mgr@x': { id: 'u-mgr', pw: 'pw' }, 'nobody@x': { id: 'u-nobody', pw: 'pw' } };
const db = window.__db = {
  admin_users: [{ user_id: 'u-owner', role: 'owner' }, { user_id: 'u-mgr', role: 'manager' }],
  categories: [{ id: 'c1', name: 'Audio', name_bn: null, slug: 'audio', description: null, image_path: null, is_visible: true, sort_order: 1 }, { id: 'c2', name: 'Empty', name_bn: null, slug: 'empty', description: null, image_path: null, is_visible: true, sort_order: 2 }],
  products: [{ id: 'p1', name: 'Existing Product', name_bn: null, slug: 'existing', short_description: 's', description: 'Old description', description_bn: null, regular_price: 1000, discount_price: null, category_id: 'c1', images: [{ path: 'products/old-full.webp', thumb: 'products/old-thumb.webp', w: 1200, h: 800, tw: 480, th: 320 }], specifications: [], stock_quantity: 5, is_available: true, is_featured: false, is_new_arrival: false, is_sample: false, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }],
  orders: [{ id: 'o1', order_number: 'NGH-261119-1001', customer_name: 'Rahim', phone: '01712345678', address: 'House 5, Dhanmondi', district: 'Dhaka', notes: 'call first', payment_method: 'bkash', transaction_reference: '9AB3C4D5EF', subtotal: 1000, delivery_charge: 70, total: 1070, status: 'pending', telegram_status: 'failed', telegram_error: 'chat not found', created_at: '2026-11-19T03:00:00Z', order_items: [{ product_name: 'Existing Product', quantity: 1, unit_price: 1000, total_price: 1000 }] }],
  store_settings: [{ id: 1, store_name: 'Nadia Gadget House', store_name_bn: 'নাদিয়া', tagline: '', tagline_bn: '', whatsapp_number: '01852316348', contact_phone: '01852316348', delivery_inside_dhaka: 70, delivery_outside_dhaka: 130, bkash_number: '', nagad_number: '', payment_instructions: { bkash: { en: 'b', bn: 'ব' }, nagad: { en: 'n', bn: 'ন' }, cod: { en: 'c', bn: 'ক' } }, homepage_banner: { title: 'Hi' } }],
  files: [], removed: [],
};
let session = null; let listener = null; let seq = 100;
const clone = (x) => JSON.parse(JSON.stringify(x));
function query(table) {
  let op = 'select', filters = [], orders = [], lim = null, payload = null, mode = null, count = false, head = false, cols = '*';
  const api = {
    select(c, o) { cols = c || '*'; if (o && o.count) { count = true; head = !!o.head; } return api; },
    insert(p) { op = 'insert'; payload = p; return api; }, update(p) { op = 'update'; payload = p; return api; }, delete() { op = 'delete'; return api; },
    eq(k, v) { filters.push((r) => r[k] === v); return api; }, or() { return api; },
    order(k, o) { orders.push([k, !(o && o.ascending === false)]); return api; }, limit(n) { lim = n; return api; },
    single() { mode = 'single'; return api; }, maybeSingle() { mode = 'maybe'; return api; },
    then(res, rej) { Promise.resolve().then(run).then(res, rej); },
  };
  function run() {
    const rows = db[table]; const match = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'insert') {
      const dupe = (Array.isArray(payload) ? payload : [payload]).find((p) => p.slug && rows.some((r) => r.slug === p.slug));
      if (dupe) return { data: null, error: { code: '23505', message: 'duplicate slug' } };
      const made = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: 'n' + (seq++), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...clone(p) }));
      rows.push(...made); return { data: clone(made), error: null };
    }
    if (op === 'update') { match.forEach((r) => Object.assign(r, clone(payload))); return { data: clone(match), error: null }; }
    if (op === 'delete') {
      if (table === 'categories' && match.some((c) => db.products.some((p) => p.category_id === c.id))) return { data: null, error: { code: '23503', message: 'FK violation' } };
      db[table] = rows.filter((r) => !match.includes(r)); return { data: null, error: null };
    }
    let out = clone(match);
    orders.slice().reverse().forEach(([k, asc]) => out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)));
    if (lim) out = out.slice(0, lim);
    if (!/order_items/.test(cols)) out = out.map((r) => { const c = { ...r }; delete c.order_items; return c; });
    if (count && head) return { data: null, count: out.length, error: null };
    if (mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'single() expected 1 row, got ' + out.length } };
    if (mode === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  return api;
}
export function createClient() {
  return {
    auth: {
      async getSession() { return { data: { session } }; },
      onAuthStateChange(cb) { listener = cb; return { data: { subscription: {} } }; },
      async signInWithPassword({ email, password }) { const u = USERS[email]; if (!u || u.pw !== password) return { data: null, error: { message: 'Invalid login credentials' } }; session = { user: { id: u.id }, access_token: 'tok-' + u.id }; return { data: { session }, error: null }; },
      async signOut() { session = null; listener && listener('SIGNED_OUT', null); return { error: null }; },
    },
    from: (t) => query(t),
    storage: { from: () => ({ async upload(p, b, o) { db.files.push({ path: p, type: b.type, size: b.size, cache: o.cacheControl }); return { error: null }; }, async remove(list) { db.removed.push(...list); return { error: null }; } }) },
  };
}
`;

const state = { retry: [] };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  if (p === '/api/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, supabaseUrl: 'http://127.0.0.1:1', supabaseAnonKey: 'anon' })); }
  if (p === '/api/retry-telegram') { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { state.retry.push({ auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, telegram: 'sent' })); }); return; }
  if (p.startsWith('/img/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  let file = path.join(PUBLIC, p === '/admin/' ? 'admin/index.html' : p);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
async function check(name, fn) { try { await fn(); results.push([true, name]); console.log('  PASS', name); } catch (e) { results.push([false, name]); console.log('  FAIL', name, '→', e.message.split('\n')[0]); } }
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
async function open(width = 1100) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page._errors = errors;
  page.on('dialog', (d) => d.accept());
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SUPABASE }));
  await page.goto(BASE + '/admin/'); await page.waitForSelector('#login-view:not([hidden])');
  return page;
}
async function login(page, email) { await page.fill('#l-email', email); await page.fill('#l-pass', 'pw'); await page.click('#login-btn'); }
const db = (page, expr) => page.evaluate(`(${expr})(window.__db)`);

console.log('Admin E2E (fake supabase-js)');

await check('login screen first; bad password rejected; panel stays hidden', async () => {
  const page = await open();
  ok(await page.locator('#app-view').isHidden(), 'app hidden');
  await page.fill('#l-email', 'owner@x'); await page.fill('#l-pass', 'wrong'); await page.click('#login-btn');
  await page.waitForSelector('#login-error:not([hidden])'); ok(await page.locator('#app-view').isHidden(), 'still hidden');
  await page.context().close();
});
await check('valid Supabase user WITHOUT admin_users row is signed out ("not authorized")', async () => {
  const page = await open(); await login(page, 'nobody@x');
  await page.waitForSelector('#login-error:not([hidden])'); ok((await page.textContent('#login-error')).includes('not authorized'), 'msg');
  ok(await page.locator('#app-view').isHidden(), 'panel hidden'); await page.context().close();
});
await check('owner login → dashboard counts, recent orders, back-to-store link, logout', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.waitForSelector('.stats');
  const nums = await page.$$eval('.stat b', (e) => e.map((x) => x.textContent.trim())); eq(nums.join(','), '1,1,1,0,2', 'products,orders,pending,completed,cats');
  ok((await page.textContent('#view')).includes('NGH-261119-1001'), 'recent order');
  eq(await page.getAttribute('#back-store', 'href'), '/');
  await page.click('#logout-btn'); await page.waitForSelector('#login-view:not([hidden])'); ok(await page.locator('#app-view').isHidden(), 'logged out');
  eq(page._errors.length, 0, page._errors.join(';')); await page.context().close();
});
await check('add product: 1,200-word English + Bangla description saved WITHOUT truncation; counters shown; reloads intact', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.waitForSelector('.stats');
  await page.click('[data-tab="products"]'); await page.click('#p-add'); await page.waitForSelector('#p-form');
  const en = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ') + '\n\n## Features\n- Fast\n- **Light**';
  const bn = Array.from({ length: 1200 }, (_, i) => `শব্দ${i}`).join(' ');
  await page.fill('#p-name', 'Big Product'); await page.fill('#p-reg', '2000'); await page.fill('#p-disc', '1500'); await page.fill('#p-stock', '9');
  await page.selectOption('#p-cat', 'c1'); await page.check('#p-feat');
  await page.fill('#p-desc', en); await page.fill('#p-desc-bn', bn);
  ok((await page.textContent('#c-desc')).includes('1,203 words'), 'word counter: ' + await page.textContent('#c-desc'));
  ok((await page.textContent('#c-desc-bn')).includes('1,200 words'), 'bn counter');
  await page.click('#spec-add'); await page.fill('.spec-row input[data-k="label"]', 'Battery'); await page.fill('.spec-row input[data-k="value"]', '30h');
  await page.click('#p-save'); await page.waitForFunction(() => !document.querySelector('#edit-dialog').open);
  const saved = await db(page, '(d) => d.products.find((p) => p.name === "Big Product")');
  eq(saved.description.length, en.length, 'description length'); eq(saved.description, en, 'description identical'); eq(saved.description_bn, bn, 'bn identical');
  eq(saved.discount_price, 1500); eq(saved.is_featured, true); eq(saved.specifications[0].label, 'Battery'); ok(/^big-product-/.test(saved.slug), 'slug');
  await page.click(`[data-edit="${saved.id}"]`); await page.waitForSelector('#p-form');
  eq(await page.inputValue('#p-desc'), en, 'editor loads full description'); ok((await page.textContent('#c-desc')).includes('1,203'), 'counter on reload');
  eq(page._errors.length, 0, page._errors.join(';')); await page.context().close();
});
await check('product validation: discount ≥ regular price and missing name are rejected', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="products"]'); await page.click('#p-add');
  await page.fill('#p-name', 'X'); await page.fill('#p-reg', '100'); await page.fill('#p-disc', '100'); await page.click('#p-save');
  await page.waitForSelector('#p-error:not([hidden])'); eq(await db(page, '(d) => d.products.length'), 1, 'nothing inserted');
  await page.fill('#p-name', ''); await page.fill('#p-disc', ''); await page.click('#p-save'); eq(await db(page, '(d) => d.products.length'), 1); await page.context().close();
});
await check('edit product price/stock/availability; delete product removes its images from storage', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="products"]');
  await page.click('[data-edit="p1"]'); await page.waitForSelector('#p-form');
  await page.fill('#p-reg', '1200'); await page.fill('#p-stock', '0'); await page.uncheck('#p-avail'); await page.click('#p-save'); await page.waitForFunction(() => !document.querySelector('#edit-dialog').open);
  const p1 = await db(page, '(d) => d.products.find((p) => p.id === "p1")'); eq(p1.regular_price, 1200); eq(p1.stock_quantity, 0); eq(p1.is_available, false);
  await page.click('[data-del="p1"]'); await page.waitForFunction(() => window.__db.products.length === 0);
  const removed = await db(page, '(d) => d.removed'); ok(removed.includes('products/old-full.webp') && removed.includes('products/old-thumb.webp'), 'storage cleanup ' + removed); await page.context().close();
});
await check('image upload: compressed to WebP (full + thumb), unique names, 1-year cache header, cover + remove', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="products"]'); await page.click('#p-add'); await page.waitForSelector('#p-form');
  await page.setInputFiles('#img-file', [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }, { name: 'b.png', mimeType: 'image/png', buffer: PNG }]);
  await page.waitForFunction(() => document.querySelectorAll('#imgs .img-tile').length === 2);
  const files = await db(page, '(d) => d.files'); eq(files.length, 4, 'full+thumb ×2');
  ok(files.every((f) => f.type === 'image/webp' && f.cache === '31536000'), JSON.stringify(files)); eq(new Set(files.map((f) => f.path)).size, 4, 'unique');
  ok(files.some((f) => f.path.endsWith('-thumb.webp')) && files.some((f) => f.path.endsWith('-full.webp')), 'variants');
  await page.click('#imgs [data-cover="1"]'); ok(await page.locator('#imgs .img-tile:first-child.cover').count() === 1, 'cover moved');
  await page.fill('#p-name', 'Img product'); await page.fill('#p-reg', '10'); await page.click('#p-save'); await page.waitForFunction(() => !document.querySelector('#edit-dialog').open);
  const saved = await db(page, '(d) => d.products.find((p) => p.name === "Img product")'); eq(saved.images.length, 2); ok(saved.images[0].thumb && saved.images[0].lqip.startsWith('data:image/'), 'thumb + blur-up lqip stored');
  eq((await db(page, '(d) => d.removed')).length, 0, 'saved uploads are not cleaned up'); await page.context().close();
});
await check('cancelling the editor deletes images uploaded in that session (no orphans)', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="products"]'); await page.click('#p-add'); await page.waitForSelector('#p-form');
  await page.setInputFiles('#img-file', [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]); await page.waitForSelector('#imgs .img-tile');
  await page.click('#edit-dialog [data-close].btn'); await page.waitForFunction(() => window.__db.removed.length === 2); await page.context().close();
});
await check('image type validation rejects non-images', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="products"]'); await page.click('#p-add'); await page.waitForSelector('#p-form');
  await page.setInputFiles('#img-file', [{ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }]); await page.waitForSelector('.toast-error');
  eq(await db(page, '(d) => d.files.length'), 0); await page.context().close();
});
await check('categories: add, edit, delete empty; delete is BLOCKED while products use it', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="categories"]'); await page.waitForSelector('#c-add');
  await page.click('[data-cdel="c1"]'); await page.waitForSelector('.toast-error'); eq(await db(page, '(d) => d.categories.length'), 2, 'in-use category kept');
  await page.click('#c-add'); await page.fill('#c-name', 'Wearables'); await page.fill('#c-name-bn', 'ওয়্যারেবল'); await page.click('#c-save'); await page.waitForFunction(() => !document.querySelector('#edit-dialog').open);
  eq(await db(page, '(d) => d.categories.length'), 3); await page.click('[data-cedit="c2"]'); await page.fill('#c-name', 'Renamed'); await page.uncheck('#c-vis'); await page.click('#c-save'); await page.waitForFunction(() => !document.querySelector('#edit-dialog').open);
  const c2 = await db(page, '(d) => d.categories.find((c) => c.id === "c2")'); eq(c2.name, 'Renamed'); eq(c2.is_visible, false);
  await page.click('[data-cdel="c2"]'); await page.waitForFunction(() => window.__db.categories.length === 2); await page.context().close();
});
await check('orders: list, filter by status, open details, change status, retry Telegram with bearer token', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="orders"]'); await page.waitForSelector('#o-list table');
  await page.selectOption('#o-status', 'delivered'); await page.waitForSelector('#o-list p.muted'); await page.selectOption('#o-status', '');
  await page.waitForSelector('[data-order="o1"]'); await page.click('[data-order="o1"]'); await page.waitForSelector('#o-st');
  const text = await page.textContent('#edit-body'); ok(text.includes('9AB3C4D5EF') && text.includes('chat not found') && text.includes('manual verification'), 'payment ref + telegram error shown');
  await page.click('#o-retry'); await page.waitForFunction(() => document.querySelector('#edit-dialog').open === false);
  eq(state.retry.length, 1); eq(state.retry[0].auth, 'Bearer tok-u-owner'); eq(state.retry[0].body.order_id, 'o1');
  await page.click('[data-order="o1"]'); await page.selectOption('#o-st', 'confirmed'); await page.click('#o-st-save');
  await page.waitForFunction(() => window.__db.orders[0].status === 'confirmed'); await page.context().close();
});
await check('settings (owner): edit delivery charge, WhatsApp, payment text, banner → saved', async () => {
  const page = await open(); await login(page, 'owner@x'); await page.click('[data-tab="settings"]'); await page.waitForSelector('#s-form');
  await page.fill('#s-din', '80'); await page.fill('#s-dout', '150'); await page.fill('#s-wa', '01999999999'); await page.fill('#s-bkash', '01800000000'); await page.fill('#s-pi-bkash-en', 'Send money'); await page.fill('#s-b-title', 'New title');
  await page.click('#s-save'); await page.waitForSelector('.toast-ok');
  const s = await db(page, '(d) => d.store_settings[0]'); eq(s.delivery_inside_dhaka, 80); eq(s.delivery_outside_dhaka, 150); eq(s.whatsapp_number, '01999999999'); eq(s.bkash_number, '01800000000');
  eq(s.payment_instructions.bkash.en, 'Send money'); eq(s.homepage_banner.title, 'New title'); await page.context().close();
});
await check('settings (manager): form is read-only with an owner-only notice', async () => {
  const page = await open(); await login(page, 'mgr@x'); await page.click('[data-tab="settings"]'); await page.waitForSelector('#s-form');
  ok(await page.locator('#s-name').isDisabled(), 'disabled'); ok(await page.locator('#s-save').isDisabled(), 'save disabled'); ok((await page.textContent('#view')).includes('owner'), 'notice'); await page.context().close();
});
await check('Bangla admin UI + no horizontal overflow at 360px', async () => {
  const page = await open(360); await login(page, 'owner@x'); await page.waitForSelector('.stats'); await page.click('#lang-btn');
  ok((await page.textContent('#tabs')).includes('ড্যাশবোর্ড'), 'bn tabs'); await page.click('[data-tab="products"]'); await page.waitForSelector('#p-rows');
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); ok(sw[0] <= sw[1], 'overflow ' + sw);
  await page.click('#p-add'); await page.waitForSelector('#p-form'); const sw2 = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); ok(sw2[0] <= sw2[1], 'editor overflow ' + sw2);
  await page.context().close();
});

await browser.close(); server.close();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
