// Browser end-to-end test of the storefront against a LOCAL MOCK backend
// (static server + fake Supabase REST + fake /api/order). It does not touch real Supabase/Telegram.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, '../../public');
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (_) { ({ chromium } = createRequire('/opt/npm-tools/node_modules/x.js')('playwright')); }

/* ---------- mock data ---------- */
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const img = (n) => [{ path: `products/p${n}-full.webp`, thumb: `products/p${n}-thumb.webp`, w: 1200, h: 1200, tw: 480, th: 480 }];
const mk = (n, name, price, disc, extra = {}) => ({
  id: uid(n), name, name_bn: `বাংলা ${name}`, slug: `p${n}`, short_description: `${name} short`, short_description_bn: null,
  regular_price: price, discount_price: disc, discount_percent: disc ? Math.round((1 - disc / price) * 100) : null, category_id: uid(901), images: img(n), specifications: [{ label: 'Battery', label_bn: 'ব্যাটারি', value: '30h' }],
  stock_quantity: 10, is_available: true, is_featured: false, is_new_arrival: false, is_sample: true, sold_count: n, created_at: `2026-11-${String(n + 1).padStart(2, '0')}T00:00:00Z`, updated_at: '2026-11-01T00:00:00Z', ...extra,
});
const PRODUCTS = [
  mk(1, 'Pulse Earbuds', 3200, 2490, { is_featured: true, is_new_arrival: true }),
  mk(2, 'Nova Smartwatch', 5800, 4290, { is_featured: true, category_id: uid(902) }),
  mk(3, 'Boom Speaker', 2400, null, { is_new_arrival: true, category_id: uid(903) }),
  mk(4, 'Chef Blender', 3900, 3190, { category_id: uid(904), stock_quantity: 2 }),
  mk(5, 'Flow Power Bank', 2800, 2250, { category_id: uid(905) }),
  mk(6, 'Zen Kettle', 2200, 1790, { category_id: uid(904), stock_quantity: 0 }),
  mk(7, 'Wave Neckband', 1500, 1190, {}),
  mk(8, 'Fit Band', 2600, null, { category_id: uid(902), is_sample: false }),
];
const CATS = [[901, 'Earbuds & Audio'], [902, 'Smartwatches'], [903, 'Speakers'], [904, 'Kitchen'], [905, 'Power']].map(([n, name], i) => ({ id: uid(n), name, name_bn: `ক্যাটাগরি ${name}`, slug: `c${n}`, image_path: null, is_visible: true, sort_order: i }));
const SETTINGS = {
  id: 1, store_name: 'Nadia Gadget House', store_name_bn: 'নাদিয়া গ্যাজেট হাউস', whatsapp_number: '01852316348', contact_phone: '01852316348',
  delivery_inside_dhaka: 70, delivery_outside_dhaka: 130, bkash_number: '01800000000', nagad_number: '01900000000', facebook_url: null, logo_url: '/assets/logo.png',
  payment_instructions: { bkash: { en: 'Send via bKash.', bn: 'বিকাশে পাঠান।' }, nagad: { en: 'Send via Nagad.', bn: 'নগদে পাঠান।' }, cod: { en: 'Pay on delivery.', bn: 'হাতে পেয়ে দিন।' } },
  homepage_banner: { badge: 'New season drop', title: 'Smart gadgets, delivered across Bangladesh', subtitle: 'Premium audio.', badge_bn: 'নতুন', title_bn: 'স্মার্ট গ্যাজেট', subtitle_bn: 'প্রিমিয়াম' },
};
const LONG_DESC = '## Highlights\n- Fast charging\n- **Bold** feature\n\nFirst paragraph.\nSecond line.\n\n<script>window.__xss=1</script>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/* ---------- mock server ---------- */
const state = { orderRequests: [], orderMode: 'ok', failFirst: false, orderCalls: 0 };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/config') return json({ ok: true, supabaseUrl: `http://127.0.0.1:${server.address().port}`, supabaseAnonKey: 'anon-key' });
  if (p === '/rest/v1/store_settings') return json([SETTINGS]);
  if (p === '/rest/v1/categories') return json(CATS);
  if (p === '/rest/v1/products') {
    const idq = url.searchParams.get('id');
    if (idq) return json([{ description: LONG_DESC, description_bn: 'বাংলা বিবরণ' }]);
    return json(PRODUCTS);
  }
  if (p.startsWith('/img/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  if (p === '/api/order' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      state.orderCalls += 1; const parsed = JSON.parse(body); state.orderRequests.push(parsed);
      if (state.failFirst && state.orderCalls === 1) return req.socket.destroy(); // simulate dropped connection
      return json({ ok: true, duplicate: false, order: { number: 'NGH-261119-1001', subtotal: 4980, deliveryCharge: 70, total: 5050 }, telegram: state.orderMode === 'ok' ? 'sent' : 'failed' }, 201);
    }); return;
  }
  let file = path.join(PUBLIC, p === '/' ? 'index.html' : p);
  if (p === '/admin/' || p === '/admin') file = path.join(PUBLIC, 'admin/index.html');
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- tiny test harness ---------- */
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  PASS', name); }
  catch (e) { results.push([false, name, e.message.split('\n')[0]]); console.log('  FAIL', name, '→', e.message.split('\n')[0]); }
}
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
async function newPage(width = 375, height = 800) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r) => r.abort());
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page._errors = errors;
  return page;
}
const ready = async (page, url = BASE + '/') => { await page.goto(url); await page.waitForSelector('#grid-all .pcard'); };

console.log('Storefront E2E (mock backend)');

await check('homepage renders products from the (mock) database; no JS errors', async () => {
  const page = await newPage(); await ready(page);
  eq(await page.locator('#grid-all .pcard').count(), 8);
  ok((await page.locator('#hero-title').textContent()).includes('Smart gadgets'), 'hero');
  eq(page._errors.length, 0, page._errors.join(';'));
  ok(await page.locator('#grid-featured .pcard').count() === 2, 'featured');
  ok(await page.locator('#grid-new .pcard').count() === 2, 'new');
  ok(await page.locator('#grid-offers .pcard').count() >= 4, 'offers');
  await page.context().close();
});
await check('sample products are labelled "Sample"; real ones are not', async () => {
  const page = await newPage(); await ready(page);
  const cards = page.locator('#grid-all .pcard');
  const labelled = await cards.filter({ has: page.locator('.tag-sample') }).count();
  eq(labelled, 7); await page.context().close();
});
await check('no horizontal overflow at 320/360/375/430/768/1280', async () => {
  for (const w of [320, 360, 375, 430, 768, 1280]) {
    const page = await newPage(w, 800); await ready(page);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    ok(sw[0] <= sw[1], `overflow at ${w}: ${sw}`); await page.context().close();
  }
});
await check('images: first products eager + fetchpriority, others lazy, explicit width/height, thumbnails used', async () => {
  const page = await newPage(); await ready(page);
  const info = await page.$$eval('#grid-featured .pimg img', (els) => els.map((e) => [e.loading, e.getAttribute('fetchpriority'), e.width, e.getAttribute('height'), e.getAttribute('src')]));
  ok(info.length >= 2 && info.every((i) => i[0] === 'eager' && i[1] === 'high'), 'eager: ' + JSON.stringify(info));
  ok(info.every((i) => i[4].includes('-thumb')), 'thumb src');
  const lazy = await page.$$eval('#grid-all .pcard:nth-child(8) .pimg img', (els) => els.map((e) => e.loading));
  eq(lazy[0], 'lazy'); await page.context().close();
});
await check('search filters products (name + Bangla + category)', async () => {
  const page = await newPage(); await ready(page);
  await page.fill('#search-input', 'nova'); await page.waitForTimeout(350);
  eq(await page.locator('#grid-all .pcard').count(), 1);
  await page.fill('#search-input', 'smartwatch'); await page.waitForTimeout(350);
  eq(await page.locator('#grid-all .pcard').count(), 2); // Nova + Fit Band (category "Smartwatches")
  await page.fill('#search-input', 'বাংলা nova'); await page.waitForTimeout(350);
  eq(await page.locator('#grid-all .pcard').count(), 1); // Bangla name + multi-token
  await page.fill('#search-input', 'kitchen'); await page.waitForTimeout(350);
  eq(await page.locator('#grid-all .pcard').count(), 2); // category-name match
  await page.fill('#search-input', 'zzzz'); await page.waitForTimeout(350);
  ok(await page.locator('#grid-all .state').count() === 1, 'empty state'); await page.context().close();
});
await check('category filter and sort (price asc / desc / popular / latest)', async () => {
  const page = await newPage(); await ready(page);
  await page.click('#cat-pills .pill:nth-child(3)'); // Smartwatches
  eq(await page.locator('#grid-all .pcard').count(), 2);
  await page.click('#cat-pills .pill:nth-child(1)');
  const prices = async () => (await page.$$eval('#grid-all .price', (e) => e.map((x) => Number(x.textContent.replace(/[^\d.]/g, '')))));
  await page.selectOption('#sort-select', 'price_asc'); let p = await prices(); ok(p.every((v, i) => i === 0 || v >= p[i - 1]), 'asc ' + p);
  await page.selectOption('#sort-select', 'price_desc'); p = await prices(); ok(p.every((v, i) => i === 0 || v <= p[i - 1]), 'desc ' + p);
  await page.selectOption('#sort-select', 'popular');
  eq((await page.locator('#grid-all .pname').first().textContent()).trim(), 'Fit Band'); // highest sold_count
  await page.selectOption('#sort-select', 'latest');
  eq((await page.locator('#grid-all .pname').first().textContent()).trim(), 'Fit Band'); await page.context().close();
});
await check('out-of-stock product shows status and disabled buttons', async () => {
  const page = await newPage(); await ready(page);
  const card = page.locator('#grid-all .pcard', { hasText: 'Zen Kettle' });
  ok((await card.textContent()).includes('Out of stock'), 'label');
  ok(await card.locator('[data-act="add"]').isDisabled(), 'add disabled'); ok(await card.locator('[data-act="buy"]').isDisabled(), 'buy disabled');
  await page.context().close();
});
await check('product details: long description rendered safely (markdown, no script injection), specs, gallery', async () => {
  const page = await newPage(); await ready(page);
  await page.click('#grid-all .pcard:has-text("Pulse Earbuds") .pname');
  await page.waitForSelector('#pd-desc h4');
  eq((await page.textContent('#pd-desc h4')).trim(), 'Highlights');
  eq(await page.locator('#pd-desc li').count(), 2);
  ok((await page.innerHTML('#pd-desc')).includes('&lt;script&gt;'), 'escaped');
  eq(await page.evaluate(() => window.__xss), undefined);
  ok((await page.textContent('.specs')).includes('Battery'), 'specs');
  ok(await page.locator('#pd-body a[href*="wa.me/8801852316348"]').count() === 1, 'whatsapp inquiry');
  await page.context().close();
});
await check('cart: add, quantity limits, remove, persistence after reload, totals', async () => {
  const page = await newPage(); await ready(page);
  await page.click('#grid-all .pcard:has-text("Chef Blender") [data-act="add"]');
  eq((await page.textContent('#cart-count')).trim(), '1');
  await page.click('#cart-btn');
  await page.click('#cart-dialog [data-act="inc"]'); // stock is 2
  await page.click('#cart-dialog [data-act="inc"]', { force: true }).catch(() => {});
  eq((await page.textContent('#cart-dialog output')).trim(), '2');
  ok(await page.locator('#cart-dialog [data-act="inc"]').isDisabled(), 'inc disabled at stock limit');
  ok((await page.textContent('#cart-foot')).includes('6,380'), 'subtotal 3190×2');
  await page.reload(); await page.waitForSelector('#grid-all .pcard');
  eq((await page.textContent('#cart-count')).trim(), '2');
  await page.click('#cart-btn'); await page.click('#cart-dialog [data-act="remove"]');
  ok((await page.textContent('#cart-body')).includes('Your cart is empty'), 'empty state');
  await page.context().close();
});
await check('cart drops deleted/unavailable products gracefully', async () => {
  const page = await newPage();
  await page.addInitScript(() => localStorage.setItem('ngh_cart_v1', JSON.stringify([{ id: '99999999-9999-4999-8999-999999999999', qty: 2 }, { id: '00000000-0000-4000-8000-000000000006', qty: 1 }])));
  await ready(page);
  ok(await page.locator('#cart-count').isHidden(), 'badge hidden');
  eq(await page.evaluate(() => localStorage.getItem('ngh_cart_v1')), '[]'); await page.context().close();
});
await check('language switch → Bangla UI + font stack, persists after reload', async () => {
  const page = await newPage(); await ready(page);
  await page.click('#lang-btn');
  ok((await page.textContent('#sec-new, #h-new')).includes('নতুন'), 'bn heading');
  ok((await page.textContent('#hero-title')).includes('স্মার্ট'), 'bn banner');
  ok((await page.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Noto Sans Bengali'), 'font');
  eq(await page.evaluate(() => document.documentElement.lang), 'bn');
  await page.reload(); await page.waitForSelector('#grid-all .pcard');
  eq(await page.evaluate(() => document.documentElement.lang), 'bn'); await page.context().close();
});
await check('mobile menu toggles; WhatsApp links use the configured number', async () => {
  const page = await newPage(); await ready(page);
  ok(!(await page.locator('#nav').isVisible()), 'nav hidden on mobile');
  await page.click('#menu-btn'); ok(await page.locator('#nav').isVisible(), 'nav open');
  await page.click('#nav a[href="#faq"]'); ok(!(await page.locator('#nav').isVisible()), 'closes on click');
  ok((await page.getAttribute('#fab-wa', 'href')).startsWith('https://wa.me/8801852316348'), 'fab link');
  ok((await page.getAttribute('#foot-wa', 'href')).startsWith('https://wa.me/8801852316348'), 'footer link'); await page.context().close();
});
await check('back-to-top button appears after scrolling and scrolls up', async () => {
  const page = await newPage(); await ready(page);
  ok(await page.locator('#fab-top').isHidden(), 'hidden at top');
  await page.evaluate(() => scrollTo(0, 2000)); await page.waitForTimeout(300);
  ok(await page.locator('#fab-top').isVisible(), 'visible'); await page.click('#fab-top'); await page.waitForTimeout(800);
  ok(await page.evaluate(() => scrollY) < 50, 'scrolled to top'); await page.context().close();
});
await check('logo falls back gracefully when the image is missing', async () => {
  const page = await newPage(); await ready(page);
  await page.waitForFunction(() => document.querySelector('#logo-header').classList.contains('fallback'));
  ok((await page.textContent('#brand-name')).includes('Nadia'), 'store name still shown'); await page.context().close();
});
await check('seven taps open /admin/; six taps or slow taps do not', async () => {
  const page = await newPage(); await ready(page);
  await page.locator('#secret-tap').scrollIntoViewIfNeeded();
  for (let i = 0; i < 6; i += 1) await page.click('#secret-tap');
  ok(!page.url().includes('/admin'), 'six taps must not navigate');
  await page.waitForTimeout(1700); // counter resets
  await page.click('#secret-tap'); ok(!page.url().includes('/admin'), 'slow 7th tap must not navigate');
  await page.waitForTimeout(1700);
  await Promise.all([page.waitForURL('**/admin/'), (async () => { for (let i = 0; i < 7; i += 1) await page.click('#secret-tap'); })()]);
  ok(page.url().endsWith('/admin/'), 'navigated'); await page.context().close();
});
await check('admin page never shows the panel without authentication', async () => {
  const page = await newPage(); await page.goto(BASE + '/admin/'); await page.waitForTimeout(800);
  ok(await page.locator('#app-view').isHidden(), 'app hidden'); ok(await page.locator('#back-store').isVisible(), 'back to store link');
  eq(await page.getAttribute('#back-store', 'href'), '/'); await page.context().close();
});

await check('checkout: client validation blocks bad input (phone, address, district, trx)', async () => {
  const page = await newPage(); await ready(page);
  await page.click('#grid-all .pcard:has-text("Pulse Earbuds") [data-act="buy"]');
  await page.waitForSelector('#ck-form');
  await page.fill('#f-name', 'R'); await page.fill('#f-phone', '12345'); await page.fill('#f-address', 'short');
  await page.check('input[value="bkash"]'); await page.click('#ck-submit');
  for (const id of ['name', 'phone', 'address', 'district', 'trx']) ok((await page.textContent('#e-' + id)).length > 0, 'error for ' + id);
  eq(state.orderRequests.length, 0, 'nothing sent'); await page.context().close();
});
await check('checkout success (Telegram sent): server payload has no prices; delivery shown; cart cleared', async () => {
  state.orderRequests.length = 0; state.orderMode = 'ok'; state.failFirst = false; state.orderCalls = 0;
  const page = await newPage(); await ready(page);
  await page.click('#grid-all .pcard:has-text("Pulse Earbuds") [data-act="buy"]'); await page.waitForSelector('#ck-form');
  await page.fill('#f-name', 'Rahim Uddin'); await page.fill('#f-phone', '০১৭১২৩৪৫৬৭৮'); await page.fill('#f-address', 'House 5, Road 3, Dhanmondi');
  await page.selectOption('#f-district', 'Dhaka');
  ok((await page.textContent('#ck-summary')).includes('2,560'), 'total with Dhaka delivery 2490+70');
  await page.selectOption('#f-district', 'Sylhet'); ok((await page.textContent('#ck-summary')).includes('2,620'), 'outside Dhaka 2490+130');
  await page.selectOption('#f-district', 'Dhaka');
  await page.check('input[value="nagad"]'); ok((await page.textContent('#pay-info')).includes('01900000000'), 'nagad number shown');
  ok((await page.textContent('#pay-info')).toLowerCase().includes('manual'), 'manual verification stated');
  await page.fill('#f-trx', '9ab3c4d5ef'); await page.click('#ck-submit');
  await page.waitForSelector('.ok-box');
  ok((await page.textContent('.ok-box')).includes('NGH-261119-1001'), 'order number'); ok((await page.textContent('.ok-box')).includes('notified'), 'telegram confirmed message');
  const sent = state.orderRequests[0];
  eq(JSON.stringify(sent).includes('price'), false, 'no price in payload'); eq(sent.items[0].qty, 1); eq(sent.paymentMethod, 'nagad'); eq(typeof sent.idempotencyKey, 'string');
  eq(await page.evaluate(() => localStorage.getItem('ngh_cart_v1')), '[]'); await page.context().close();
});
await check('checkout success but Telegram failed: warning shown, no false "notified" claim', async () => {
  state.orderMode = 'failed'; state.failFirst = false; state.orderCalls = 0;
  const page = await newPage(); await ready(page);
  await page.click('#grid-all .pcard:has-text("Boom Speaker") [data-act="buy"]'); await page.waitForSelector('#ck-form');
  await page.fill('#f-name', 'Karim'); await page.fill('#f-phone', '01812345678'); await page.fill('#f-address', 'Village X, Post Y, Upazila Z'); await page.selectOption('#f-district', 'Khulna');
  await page.click('#ck-submit'); await page.waitForSelector('.ok-box');
  ok(await page.locator('.ok-box .warn').count() === 1, 'warning box'); ok(!(await page.textContent('.ok-box')).includes('has been notified'), 'no false claim'); await page.context().close();
});
await check('network failure keeps the SAME idempotency key on retry (no duplicate orders)', async () => {
  state.orderMode = 'ok'; state.failFirst = false; state.orderCalls = 0;
  const page = await newPage(); await ready(page);
  const keys = []; let n = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/order')) keys.push(JSON.parse(r.postData()).idempotencyKey); });
  await page.route('**/api/order', (r) => (n++ === 0 ? r.abort('connectionreset') : r.continue()));
  await page.click('#grid-all .pcard:has-text("Boom Speaker") [data-act="buy"]'); await page.waitForSelector('#ck-form');
  await page.fill('#f-name', 'Karim'); await page.fill('#f-phone', '01812345678'); await page.fill('#f-address', 'Village X, Post Y, Upazila Z'); await page.selectOption('#f-district', 'Khulna');
  await page.click('#ck-submit'); await page.waitForSelector('#ck-error:not([hidden])');
  ok((await page.textContent('#ck-error')).toLowerCase().includes('network'), 'network error message');
  ok(await page.locator('.ok-box').count() === 0, 'no false success');
  await page.click('#ck-submit'); await page.waitForSelector('.ok-box');
  eq(keys.length, 2); eq(keys[0], keys[1], 'same key on retry'); await page.context().close();
});
await check('double-click on Place order sends only one request', async () => {
  state.orderRequests.length = 0; state.orderMode = 'ok';
  const page = await newPage(); await ready(page);
  await page.click('#grid-all .pcard:has-text("Boom Speaker") [data-act="buy"]'); await page.waitForSelector('#ck-form');
  await page.fill('#f-name', 'Karim'); await page.fill('#f-phone', '01812345678'); await page.fill('#f-address', 'Village X, Post Y, Upazila Z'); await page.selectOption('#f-district', 'Khulna');
  await page.dblclick('#ck-submit'); await page.waitForSelector('.ok-box');
  eq(state.orderRequests.length, 1); await page.context().close();
});

if (process.env.SHOTS) {
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  const d = await newPage(1280, 900); await ready(d); await d.waitForTimeout(500);
  await d.screenshot({ path: path.join(process.env.SHOTS, 'desktop-top.png') });
  await d.screenshot({ path: path.join(process.env.SHOTS, 'desktop-full.png'), fullPage: true });
  const m = await newPage(375, 800); await ready(m); await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(process.env.SHOTS, 'mobile-top.png') });
  await m.evaluate(() => document.querySelector('#featured').scrollIntoView()); await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(process.env.SHOTS, 'mobile-products.png') });
  await m.click('#grid-featured .pname'); await m.waitForSelector('#pd-desc h4'); await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(process.env.SHOTS, 'mobile-detail.png') });
  await m.keyboard.press('Escape'); await m.click('#grid-featured [data-act="buy"]'); await m.waitForSelector('#ck-form'); await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(process.env.SHOTS, 'mobile-checkout.png') });
}
await browser.close(); server.close();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
