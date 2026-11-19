// Nadia Gadget House — storefront application.
// Data comes from Supabase (REST, read-only via the public anon key + RLS).
// Orders are submitted to /api/order (server validates and prices everything).
import { DISTRICTS, DISTRICTS_BN } from './i18n.js';
import {
  t, getLang, setLang, applyI18n, esc, money, num, pick, imgUrl, renderRichText, toast, debounce,
  loadConfig, waLink,
} from './common.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CART_KEY = 'ngh_cart_v1';
const LIST_COLUMNS = 'id,name,name_bn,slug,short_description,short_description_bn,regular_price,discount_price,discount_percent,category_id,images,specifications,stock_quantity,is_available,is_featured,is_new_arrival,is_sample,sold_count,created_at,updated_at';

const state = {
  cfg: null, settings: null, categories: [], products: [], loaded: false, error: false,
  cart: [], filter: { q: '', cat: 'all', sort: 'latest' }, lastFetch: 0,
  descCache: new Map(), orderAttempt: null, submitting: false, eagerBudget: 4,
};

/* ---------------------------------------------------------------- data */
function authHeaders() {
  const k = state.cfg.supabaseAnonKey;
  const h = { apikey: k, Accept: 'application/json' };
  if (k.startsWith('eyJ')) h.Authorization = `Bearer ${k}`;
  return h;
}
async function rest(path) {
  const res = await fetch(`${state.cfg.supabaseUrl}/rest/v1/${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`REST ${res.status}`);
  return res.json();
}
async function fetchAll() {
  const [settings, categories, products] = await Promise.all([
    rest('store_settings?select=*&id=eq.1'),
    rest('categories?select=*&is_visible=eq.true&order=sort_order.asc,name.asc'),
    rest(`products?select=${LIST_COLUMNS}&order=created_at.desc&limit=1000`),
  ]);
  state.settings = settings[0] || {};
  state.categories = categories;
  state.products = products;
  state.loaded = true; state.error = false; state.lastFetch = Date.now();
  // Descriptions may have changed in the admin panel.
  state.descCache.clear();
}
async function refresh({ silent = true } = {}) {
  try {
    await fetchAll();
    reconcileCart(true);
    renderAll();
  } catch (e) {
    if (!state.loaded) { state.error = true; renderAll(); }
    else if (!silent) toast(t('load_error'), 'error');
  }
}

/* ---------------------------------------------------------------- helpers */
const eff = (p) => (p.discount_price != null && Number(p.discount_price) < Number(p.regular_price) ? Number(p.discount_price) : Number(p.regular_price));
const hasDiscount = (p) => eff(p) < Number(p.regular_price);
const stockOf = (p) => (p.is_available ? Math.max(0, Number(p.stock_quantity) || 0) : 0);
const catName = (c) => pick(c, 'name');
const productById = (id) => state.products.find((p) => p.id === id);
const settings = () => state.settings || {};
const storeName = () => (getLang() === 'bn' ? settings().store_name_bn : settings().store_name) || settings().store_name || 'Nadia Gadget House';
const cartCount = () => state.cart.reduce((n, l) => n + l.qty, 0);
const cartSubtotal = () => state.cart.reduce((s, l) => { const p = productById(l.id); return s + (p ? eff(p) * l.qty : 0); }, 0);
const delivery = (district) => (district === 'Dhaka' ? Number(settings().delivery_inside_dhaka ?? 70) : Number(settings().delivery_outside_dhaka ?? 130));
const PH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>';

function setImgFallback(img) {
  const holder = img.closest('.pimg, .line-img, .main, .thumbs button, .cat');
  img.style.display = 'none';
  if (holder && !holder.querySelector('.ph')) holder.insertAdjacentHTML('beforeend', `<span class="ph">${PH_SVG}</span>`);
}
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement)) return;
  if (el.classList.contains('logo')) { el.classList.add('fallback'); return; }
  setImgFallback(el);
}, true);
document.addEventListener('load', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.classList.add('loaded');
}, true);

/** <img> markup for a product. Thumbnails for cards; the full image only where it is shown large. */
function productImg(p, { eager = false, full = false, sizes = '(min-width:1024px) 25vw, (min-width:768px) 33vw, 50vw', alt } = {}) {
  const img = Array.isArray(p.images) ? p.images[0] : null;
  if (!img || !img.path) return `<span class="ph">${PH_SVG}</span>`;
  const thumb = img.thumb || img.path;
  const src = imgUrl(full ? img.path : thumb);
  const w = full ? (img.w || 1200) : (img.tw || 480);
  const h = full ? (img.h || 1200) : (img.th || 480);
  const srcset = !full && img.thumb && img.path ? ` srcset="${imgUrl(img.thumb)} ${img.tw || 480}w, ${imgUrl(img.path)} ${img.w || 1200}w" sizes="${sizes}"` : '';
  const loading = eager ? 'eager' : 'lazy';
  const prio = eager ? ' fetchpriority="high"' : '';
  return `<img src="${esc(src)}"${srcset} width="${w}" height="${h}" alt="${esc(alt ?? pick(p, 'name'))}" loading="${loading}" decoding="async"${prio}>`;
}
const lqipStyle = (p) => { const l = Array.isArray(p.images) && p.images[0]?.lqip; return l && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(l) ? ` style="background-image:url(${l})"` : ''; };

/* ---------------------------------------------------------------- cart */
function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    state.cart = Array.isArray(raw) ? raw.filter((l) => l && typeof l.id === 'string' && Number.isInteger(l.qty) && l.qty > 0).slice(0, 30) : [];
  } catch (_) { state.cart = []; }
}
function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (_) { /* ignore */ } }
function reconcileCart(announce) {
  let removed = false; let adjusted = false;
  state.cart = state.cart.filter((l) => {
    const p = productById(l.id);
    if (!p || stockOf(p) < 1) { removed = true; return false; }
    if (l.qty > stockOf(p)) { l.qty = stockOf(p); adjusted = true; }
    if (l.qty > 20) { l.qty = 20; adjusted = true; }
    return true;
  });
  if (removed || adjusted) saveCart();
  if (announce && removed) toast(t('unavailable_removed'), 'error');
  else if (announce && adjusted) toast(t('stock_adjusted'));
}
function addToCart(id, qty = 1, { silent = false } = {}) {
  const p = productById(id);
  if (!p) return false;
  const max = Math.min(stockOf(p), 20);
  if (max < 1) { toast(t('out_of_stock'), 'error'); return false; }
  const line = state.cart.find((l) => l.id === id);
  const next = (line ? line.qty : 0) + qty;
  if (next > max) { toast(t('max_stock', { n: max }), 'error'); if (line) line.qty = max; else state.cart.push({ id, qty: max }); }
  else if (line) line.qty = next; else state.cart.push({ id, qty });
  saveCart(); renderCartBadge(); renderCart();
  if (!silent) toast(t('added'), 'ok');
  return true;
}
function setQty(id, qty) {
  const line = state.cart.find((l) => l.id === id); const p = productById(id);
  if (!line || !p) return;
  const max = Math.min(stockOf(p), 20);
  if (qty < 1) { state.cart = state.cart.filter((l) => l.id !== id); }
  else if (qty > max) { line.qty = max; toast(t('max_stock', { n: max }), 'error'); }
  else line.qty = qty;
  saveCart(); renderCartBadge(); renderCart();
}
function renderCartBadge() {
  const n = cartCount(); const el = $('#cart-count');
  el.hidden = n === 0; el.textContent = num(n);
}
function renderCart() {
  const body = $('#cart-body'); const foot = $('#cart-foot');
  if (!state.cart.length) {
    body.innerHTML = `<div class="empty-cart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h15l-1.6 9H7.6L6 3H3"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M10 10l4 3m0-3-4 3"/></svg><h3>${esc(t('cart_empty'))}</h3><p>${esc(t('cart_empty_s'))}</p></div>`;
    foot.innerHTML = `<button class="btn btn-ghost" style="width:100%" type="button" data-act="close-dialog">${esc(t('continue_shopping'))}</button>`;
    return;
  }
  body.innerHTML = state.cart.map((l) => {
    const p = productById(l.id); if (!p) return '';
    const max = Math.min(stockOf(p), 20);
    return `<div class="line">
      <div class="line-img">${productImg(p, { sizes: '64px' })}</div>
      <div><div class="line-name">${esc(pick(p, 'name'))}</div>
        <div class="line-price">${money(eff(p))}</div>
        <div class="qty" role="group" aria-label="${esc(t('qty'))}">
          <button type="button" data-act="dec" data-id="${esc(p.id)}" aria-label="−">−</button>
          <output>${num(l.qty)}</output>
          <button type="button" data-act="inc" data-id="${esc(p.id)}" aria-label="+" ${l.qty >= max ? 'disabled' : ''}>+</button>
        </div>
        <div><button class="link-btn" type="button" data-act="remove" data-id="${esc(p.id)}">${esc(t('remove'))}</button></div>
      </div>
      <div><b>${money(eff(p) * l.qty)}</b></div></div>`;
  }).join('');
  foot.innerHTML = `<div class="sum"><div><span>${esc(t('subtotal'))}</span><b>${money(cartSubtotal())}</b></div></div>
    <p class="muted small" style="margin:0 0 10px">${esc(t('delivery_note'))}</p>
    <button class="btn btn-primary" style="width:100%" type="button" data-act="checkout">${esc(t('checkout'))}</button>`;
}

/* ---------------------------------------------------------------- rendering */
function badgesFor(p) {
  const out = [];
  if (hasDiscount(p)) out.push(`<span class="tag tag-off">${esc(t('off', { n: num(p.discount_percent ?? Math.round((1 - eff(p) / p.regular_price) * 100)) }))}</span>`);
  if (p.is_new_arrival) out.push(`<span class="tag tag-new">${esc(t('badge_new'))}</span>`);
  if (p.is_featured) out.push(`<span class="tag tag-feat">${esc(t('badge_featured'))}</span>`);
  if (p.is_sample) out.push(`<span class="tag tag-sample">${esc(t('badge_sample'))}</span>`);
  return out.join('');
}
function stockLabel(p) {
  const s = stockOf(p);
  if (s < 1) return `<span class="stock out">${esc(t('out_of_stock'))}</span>`;
  if (s <= 5) return `<span class="stock low">${esc(t('low_stock', { n: num(s) }))}</span>`;
  return `<span class="stock ok">${esc(t('in_stock'))}</span>`;
}
function priceHtml(p) {
  return `<div class="prices"><span class="price">${money(eff(p))}</span>${hasDiscount(p) ? `<span class="price-old">${money(p.regular_price)}</span>` : ''}</div>`;
}
function productCard(p) {
  const out = stockOf(p) < 1;
  const eager = state.eagerBudget > 0; if (eager) state.eagerBudget -= 1;
  return `<article class="pcard">
    <button class="pimg ${out ? 'soldout' : ''}" type="button" data-act="details" data-id="${esc(p.id)}" aria-label="${esc(t('view_details'))}: ${esc(pick(p, 'name'))}"${lqipStyle(p)}>
      ${productImg(p, { eager })}<span class="tags">${badgesFor(p)}</span>
    </button>
    <div class="pbody">
      <button class="pname" type="button" data-act="details" data-id="${esc(p.id)}">${esc(pick(p, 'name'))}</button>
      <p class="pshort">${esc(pick(p, 'short_description') || '')}</p>
      ${priceHtml(p)} ${stockLabel(p)}
      <div class="pactions">
        <button class="btn btn-ghost" type="button" data-act="add" data-id="${esc(p.id)}" ${out ? 'disabled' : ''}>${esc(out ? t('sold_out') : t('add_to_cart'))}</button>
        <button class="btn btn-primary" type="button" data-act="buy" data-id="${esc(p.id)}" ${out ? 'disabled' : ''}>${esc(t('buy_now'))}</button>
        <button class="pcard-link" type="button" data-act="details" data-id="${esc(p.id)}">${esc(t('view_details'))} →</button>
      </div>
    </div></article>`;
}
const skeletons = (n = 4) => Array.from({ length: n }, () => '<div class="skel" aria-hidden="true"></div>').join('');

function renderGrid(sel, list, sectionId) {
  const grid = $(sel); const section = sectionId ? $(sectionId) : null;
  if (state.error) { grid.innerHTML = errorState(); if (section) section.hidden = false; return; }
  if (!state.loaded) { grid.innerHTML = skeletons(); return; }
  if (section) section.hidden = list.length === 0;
  grid.innerHTML = list.map(productCard).join('');
}
const errorState = () => `<div class="state"><p>${esc(t('load_error'))}</p><button class="btn btn-primary" type="button" data-act="reload">${esc(t('retry'))}</button></div>`;

function filteredProducts() {
  const { q, cat, sort } = state.filter;
  const tokens = q.toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean);
  let list = state.products.filter((p) => {
    if (cat !== 'all' && p.category_id !== cat) return false;
    if (!tokens.length) return true;
    const c = state.categories.find((x) => x.id === p.category_id);
    const hay = [p.name, p.name_bn, p.short_description, p.short_description_bn, c?.name, c?.name_bn].filter(Boolean).join(' ').toLowerCase();
    return tokens.every((tk) => hay.includes(tk));
  });
  const by = {
    latest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    popular: (a, b) => (b.sold_count - a.sold_count) || (Number(b.is_featured) - Number(a.is_featured)),
    price_asc: (a, b) => eff(a) - eff(b),
    price_desc: (a, b) => eff(b) - eff(a),
  }[sort] || (() => 0);
  list = list.slice().sort(by);
  return list;
}

function renderAll() {
  applySettings();
  state.eagerBudget = 4;
  renderCategories();
  const feat = state.products.filter((p) => p.is_featured).slice(0, 8);
  const offers = state.products.filter(hasDiscount).sort((a, b) => (b.discount_percent || 0) - (a.discount_percent || 0)).slice(0, 8);
  const fresh = state.products.filter((p) => p.is_new_arrival).slice(0, 8);
  renderGrid('#grid-featured', feat, '#featured');
  renderGrid('#grid-offers', offers, '#offers');
  renderGrid('#grid-new', fresh, '#new');
  renderShop();
  renderCartBadge(); renderCart();
}
function renderShop() {
  const grid = $('#grid-all'); const count = $('#count');
  if (state.error) { grid.innerHTML = errorState(); count.textContent = ''; return; }
  if (!state.loaded) { grid.innerHTML = skeletons(8); count.textContent = ''; return; }
  const list = filteredProducts();
  const total = list.length;
  count.textContent = total === 1 ? t('product_one') : t('products_count', { n: num(total) });
  grid.innerHTML = total ? list.map(productCard).join('')
    : `<div class="state"><p>${esc(t('empty_results'))}</p><button class="btn btn-ghost" type="button" data-act="clear-filters">${esc(t('clear_filters'))}</button></div>`;
}
function renderCategories() {
  const cats = state.categories;
  const pills = [`<button class="pill" type="button" data-act="filter-cat" data-cat="all" aria-pressed="${state.filter.cat === 'all'}">${esc(t('all'))}</button>`]
    .concat(cats.map((c) => `<button class="pill" type="button" data-act="filter-cat" data-cat="${esc(c.id)}" aria-pressed="${state.filter.cat === c.id}">${esc(catName(c))}</button>`));
  $('#cat-pills').innerHTML = pills.join('');
  const sec = $('#categories'); sec.hidden = state.loaded && cats.length === 0;
  $('#cats-grid').innerHTML = state.loaded ? cats.map((c) => `<button class="cat" type="button" data-act="filter-cat" data-cat="${esc(c.id)}" data-scroll="1">
      ${c.image_path ? `<img src="${esc(imgUrl(c.image_path))}" width="400" height="300" alt="" loading="lazy" decoding="async">` : ''}<span>${esc(catName(c))}</span></button>`).join('') : skeletons(3);
  $('#foot-cats').innerHTML = cats.map((c) => `<li><a href="#shop" data-act="filter-cat" data-cat="${esc(c.id)}" data-scroll="1">${esc(catName(c))}</a></li>`).join('');
}
function applySettings() {
  const s = settings(); const lang = getLang(); const b = s.homepage_banner || {};
  const name = storeName();
  $('#brand-name').textContent = name; $('#brand-name-f').textContent = name; $('#brand-name-c').textContent = name;
  document.title = `${name} — ${lang === 'bn' ? 'বাংলাদেশে প্রিমিয়াম গ্যাজেট অনলাইনে' : 'Premium Gadgets Online in Bangladesh'}`;
  const logo = s.logo_url || '/assets/logo.png';
  for (const id of ['logo-header', 'logo-footer']) { const el = $('#' + id); if (el.getAttribute('src') !== logo) { el.classList.remove('fallback'); el.src = logo; } el.alt = name; }
  if (b.badge) $('#hero-badge').textContent = lang === 'bn' && b.badge_bn ? b.badge_bn : b.badge;
  if (b.title) $('#hero-title').textContent = lang === 'bn' && b.title_bn ? b.title_bn : b.title;
  if (b.subtitle) $('#hero-sub').textContent = lang === 'bn' && b.subtitle_bn ? b.subtitle_bn : b.subtitle;
  const art = $('#hero-art');
  if (b.image_path && !art.dataset.img) {
    art.dataset.img = b.image_path;
    // LCP element: eager + high priority, explicit dimensions.
    art.innerHTML = `<img src="${esc(imgUrl(b.image_path))}" width="${Number(b.image_w) || 1200}" height="${Number(b.image_h) || 800}" alt="" fetchpriority="high" loading="eager" decoding="async">`;
  }
  $('#del-in').textContent = money(s.delivery_inside_dhaka ?? 70); $('#del-out').textContent = money(s.delivery_outside_dhaka ?? 130);
  const wa = waLink(s.whatsapp_number || '01852316348', lang === 'bn' ? 'হ্যালো!' : 'Hello!');
  $('#fab-wa').href = wa; $('#foot-wa').href = wa; $('#foot-wa').textContent = `WhatsApp: ${s.whatsapp_number || '01852316348'}`;
  const phone = s.contact_phone || s.whatsapp_number || '';
  $('#foot-tel').textContent = phone || '—'; $('#foot-tel').href = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : '#';
  const fb = $('#foot-fb'); fb.hidden = !/^https:\/\//.test(s.facebook_url || ''); if (!fb.hidden) fb.href = s.facebook_url;
  $('#lang-btn').textContent = lang === 'bn' ? 'English' : 'বাংলা';
  $('#year').textContent = new Date().getFullYear();
}

/* ---------------------------------------------------------------- product details */
async function openDetails(id, { qty = 1 } = {}) {
  const p = productById(id); if (!p) return;
  const dlg = $('#product-dialog'); const body = $('#pd-body');
  const imgs = (Array.isArray(p.images) ? p.images : []).filter((i) => i && i.path);
  const out = stockOf(p) < 1; const max = Math.min(stockOf(p), 20);
  const specs = (Array.isArray(p.specifications) ? p.specifications : []).filter((s) => s && s.label)
    .map((s) => `<tr><th>${esc(getLang() === 'bn' && s.label_bn ? s.label_bn : s.label)}</th><td>${esc(s.value)}</td></tr>`).join('');
  body.innerHTML = `
    <div class="pd-gallery">
      <div class="main" id="pd-main">${imgs.length ? `<img src="${esc(imgUrl(imgs[0].path))}" width="${imgs[0].w || 1200}" height="${imgs[0].h || 1200}" alt="${esc(pick(p, 'name'))}" fetchpriority="high" decoding="async">` : `<span class="ph">${PH_SVG}</span>`}</div>
      ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((im, i) => `<button type="button" data-act="gallery" data-i="${i}" aria-label="${i + 1}" aria-current="${i === 0}"><img src="${esc(imgUrl(im.thumb || im.path))}" width="60" height="60" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
    <div>
      <div class="tags" style="position:static;margin-bottom:8px">${badgesFor(p)}</div>
      <h2 id="pd-name">${esc(pick(p, 'name'))}</h2>
      <p class="muted">${esc(pick(p, 'short_description') || '')}</p>
      ${p.is_sample ? `<div class="note-sample">${esc(t('sample_note'))}</div>` : ''}
      ${priceHtml(p)} <p>${stockLabel(p)}</p>
      <div class="buy-row">
        <div class="qty" role="group" aria-label="${esc(t('qty'))}">
          <button type="button" data-act="pd-dec" aria-label="−" ${out ? 'disabled' : ''}>−</button><output id="pd-qty">${num(qty)}</output><button type="button" data-act="pd-inc" aria-label="+" ${out ? 'disabled' : ''}>+</button>
        </div>
        <button class="btn btn-ghost" type="button" data-act="pd-add" data-id="${esc(p.id)}" ${out ? 'disabled' : ''}>${esc(out ? t('sold_out') : t('add_to_cart'))}</button>
        <button class="btn btn-primary" type="button" data-act="pd-buy" data-id="${esc(p.id)}" ${out ? 'disabled' : ''}>${esc(t('buy_now'))}</button>
      </div>
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(waLink(settings().whatsapp_number || '01852316348', (getLang() === 'bn' ? 'আমি এই পণ্য সম্পর্কে জানতে চাই: ' : "Hello! I'd like to ask about: ") + pick(p, 'name')))}">${esc(t('ask_whatsapp'))}</a>
      ${specs ? `<h3 style="margin-top:20px">${esc(t('specs'))}</h3><table class="specs"><tbody>${specs}</tbody></table>` : ''}
      <h3 style="margin-top:16px">${esc(t('description'))}</h3>
      <div class="rich" id="pd-desc"><p class="muted">${esc(t('loading'))}</p></div>
    </div>`;
  dlg.dataset.qty = String(qty); dlg.dataset.max = String(max); dlg.dataset.imgs = JSON.stringify(imgs.map((i) => i.path));
  dlg.dataset.w = JSON.stringify(imgs.map((i) => [i.w || 1200, i.h || 1200]));
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  // Full description is fetched on demand — keeps the product list light for mobile data.
  try {
    let d = state.descCache.get(id);
    if (!d) {
      const rows = await rest(`products?select=description,description_bn&id=eq.${encodeURIComponent(id)}`);
      d = rows[0] || {}; state.descCache.set(id, d);
    }
    const text = (getLang() === 'bn' && d.description_bn) ? d.description_bn : d.description;
    const box = $('#pd-desc');
    if (box && $('#product-dialog').open) box.innerHTML = text ? renderRichText(text) : `<p class="muted">—</p>`;
  } catch (_) {
    const box = $('#pd-desc'); if (box) box.innerHTML = `<p class="muted">${esc(t('load_error'))} <button class="link-btn" style="color:#8bf0ff" type="button" data-act="reopen" data-id="${esc(id)}">${esc(t('retry'))}</button></p>`;
  }
}

/* ---------------------------------------------------------------- checkout */
const ERR_KEY = { NAME_REQUIRED: 'err_name', PHONE_INVALID: 'err_phone', ADDRESS_TOO_SHORT: 'err_address', DISTRICT_INVALID: 'err_district', TRX_INVALID: 'err_trx', ITEMS_INVALID: 'err_items' };

export function normalizePhone(input) {
  let s = String(input ?? '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/[\s\-().]/g, '');
  if (s.startsWith('+88')) s = s.slice(3); else if (s.startsWith('88') && s.length === 13) s = s.slice(2);
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

function openCheckout() {
  reconcileCart(true);
  if (!state.cart.length) { toast(t('cart_empty'), 'error'); return; }
  if ($('#cart-dialog').open) $('#cart-dialog').close();
  const s = settings(); const lang = getLang(); const pi = s.payment_instructions || {};
  const instr = (k) => (pi[k] && (pi[k][lang] || pi[k].en)) || '';
  const districtOpts = DISTRICTS.map((d) => `<option value="${esc(d)}">${esc(lang === 'bn' ? DISTRICTS_BN[d] : d)}</option>`).join('');
  $('#ck-body').innerHTML = `
    <h2 id="ck-title">${esc(t('ck_title'))}</h2>
    <form id="ck-form" novalidate>
      <div id="ck-error" class="form-error" role="alert" hidden></div>
      <div class="field"><label for="f-name">${esc(t('ck_name'))}</label><input id="f-name" name="name" autocomplete="name" maxlength="80" required aria-describedby="e-name"><span class="err" id="e-name"></span></div>
      <div class="field"><label for="f-phone">${esc(t('ck_phone'))}</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="${esc(t('ck_phone_h'))}" required aria-describedby="e-phone"><span class="err" id="e-phone"></span></div>
      <div class="field"><label for="f-address">${esc(t('ck_address'))}</label><textarea id="f-address" name="address" autocomplete="street-address" maxlength="300" required aria-describedby="e-address"></textarea><span class="err" id="e-address"></span></div>
      <div class="field"><label for="f-district">${esc(t('ck_district'))}</label><select id="f-district" name="district" required aria-describedby="e-district"><option value="">${esc(t('ck_district_ph'))}</option>${districtOpts}</select><span class="err" id="e-district"></span></div>
      <div class="field"><label for="f-notes">${esc(t('ck_notes'))}</label><textarea id="f-notes" name="notes" maxlength="500"></textarea></div>
      <fieldset class="pay-opts field"><legend>${esc(t('ck_payment'))}</legend>
        <label class="pay-opt"><input type="radio" name="pay" value="cod" checked> ${esc(t('pay_cod'))}</label>
        <label class="pay-opt"><input type="radio" name="pay" value="bkash"> ${esc(t('pay_bkash'))}</label>
        <label class="pay-opt"><input type="radio" name="pay" value="nagad"> ${esc(t('pay_nagad'))}</label>
      </fieldset>
      <div id="pay-info"></div>
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-primary" id="ck-submit" type="submit" style="width:100%">${esc(t('ck_place'))}</button>
      <button class="btn btn-ghost" type="button" data-act="back-cart" style="width:100%;margin-top:8px">${esc(t('ck_back'))}</button>
    </form>
    <aside><h3>${esc(t('ck_summary'))}</h3><div id="ck-summary"></div></aside>`;
  const form = $('#ck-form');
  const updatePay = () => {
    const m = form.pay.value; const box = $('#pay-info');
    if (m === 'cod') { box.innerHTML = `<div class="pay-info">${esc(instr('cod'))}</div>`; return; }
    const number = m === 'bkash' ? s.bkash_number : s.nagad_number;
    box.innerHTML = `<div class="pay-info"><p style="margin:0 0 6px">${esc(instr(m))}</p>
      ${number ? `<p style="margin:0">${esc(t('pay_number'))}: <span class="num">${esc(number)}</span></p>` : ''}
      <p class="muted small" style="margin:6px 0 0">${esc(t('pay_manual'))}</p></div>
      <div class="field"><label for="f-trx">${esc(t('ck_trx'))}</label><input id="f-trx" name="trx" maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="${esc(t('ck_trx_h'))}" required aria-describedby="e-trx"><span class="err" id="e-trx"></span></div>`;
  };
  const updateSummary = () => {
    const d = form.district.value; const sub = cartSubtotal(); const del = d ? delivery(d) : null;
    $('#ck-summary').innerHTML = state.cart.map((l) => { const p = productById(l.id); return p ? `<div class="line" style="grid-template-columns:1fr auto"><div><div class="line-name">${esc(pick(p, 'name'))}</div><div class="line-price">${money(eff(p))} × ${num(l.qty)}</div></div><b>${money(eff(p) * l.qty)}</b></div>` : ''; }).join('')
      + `<div class="sum" style="margin-top:12px"><div><span>${esc(t('subtotal'))}</span><b>${money(sub)}</b></div><div><span>${esc(t('delivery'))}</span><b>${del == null ? '—' : money(del)}</b></div><div class="grand"><span>${esc(t('total'))}</span><b>${money(sub + (del || 0))}</b></div></div>`;
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'pay') updatePay(); if (e.target.name === 'district') updateSummary(); });
  form.addEventListener('submit', submitOrder);
  updatePay(); updateSummary();
  const dlg = $('#checkout-dialog'); if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

function setFieldError(id, key) {
  const input = $('#f-' + id); const err = $('#e-' + id);
  if (!input || !err) return;
  err.textContent = key ? t(key) : '';
  if (key) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}
function showFormError(msg) { const e = $('#ck-error'); if (!e) return; e.hidden = !msg; e.textContent = msg || ''; if (msg) e.scrollIntoView({ block: 'nearest' }); }

async function submitOrder(ev) {
  ev.preventDefault();
  if (state.submitting) return;
  const f = ev.currentTarget;
  const v = {
    name: f.name.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(), district: f.district.value,
    notes: f.notes.value.trim(), pay: f.pay.value, trx: (f.trx?.value || '').trim().toUpperCase(),
  };
  showFormError('');
  const errs = {};
  if (v.name.length < 2) errs.name = 'err_name';
  if (!normalizePhone(v.phone)) errs.phone = 'err_phone';
  if (v.address.length < 10) errs.address = 'err_address';
  if (!v.district) errs.district = 'err_district';
  if (v.pay !== 'cod' && !/^[A-Z0-9]{6,20}$/.test(v.trx)) errs.trx = 'err_trx';
  for (const id of ['name', 'phone', 'address', 'district', 'trx']) setFieldError(id, errs[id]);
  const first = Object.keys(errs)[0];
  if (first) { $('#f-' + first)?.focus(); return; }

  const payload = {
    customer: { name: v.name, phone: v.phone, address: v.address, district: v.district, notes: v.notes },
    paymentMethod: v.pay, transactionReference: v.pay === 'cod' ? '' : v.trx,
    items: state.cart.map((l) => ({ id: l.id, qty: l.qty })), lang: getLang(), website: f.website.value,
  };
  // The idempotency key is reused only while the payload is unchanged, so a retry after a
  // network failure can never create a second order — but a corrected form gets a fresh key.
  const fp = JSON.stringify(payload);
  if (!state.orderAttempt || state.orderAttempt.fp !== fp) state.orderAttempt = { fp, key: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '') };
  payload.idempotencyKey = state.orderAttempt.key;

  state.submitting = true;
  const btn = $('#ck-submit'); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${esc(t('ck_placing'))}`;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) { state.orderAttempt = null; return onOrderSuccess(data, v); }
    state.orderAttempt = res.status >= 500 ? state.orderAttempt : null; // definitive client errors → new key next time
    handleOrderError(res.status, data);
  } catch (_) {
    showFormError(t('err_network')); // outcome unknown → keep key; retry is safe (idempotent)
  } finally {
    clearTimeout(timer); state.submitting = false;
    const b = $('#ck-submit'); if (b) { b.disabled = false; b.textContent = t('ck_place'); }
  }
}

function handleOrderError(status, data) {
  const code = data?.error;
  if (status === 422 && data.fields) {
    const map = { name: 'name', phone: 'phone', address: 'address', district: 'district', transactionReference: 'trx' };
    let any = false;
    for (const [field, c] of Object.entries(data.fields)) { const id = map[field]; if (id && ERR_KEY[c]) { setFieldError(id, ERR_KEY[c]); any = true; } }
    if (data.fields.items) { showFormError(t('err_items')); any = true; }
    if (!any) showFormError(t('err_server'));
    return;
  }
  if (code === 'OUT_OF_STOCK' || code === 'PRODUCT_NOT_FOUND') {
    showFormError(code === 'OUT_OF_STOCK' ? t('err_stock', { name: data.productName || '', n: num(data.available ?? 0) }) : t('unavailable_removed'));
    refresh({ silent: true });
    return;
  }
  if (code === 'RATE_LIMITED') return showFormError(t('err_rate'));
  if (code === 'SERVER_NOT_CONFIGURED') return showFormError(t('err_config'));
  showFormError(t('err_server'));
}

function onOrderSuccess(data, v) {
  const o = data.order; const sent = data.telegram === 'sent';
  state.cart = []; saveCart(); renderCartBadge(); renderCart();
  const wa = waLink(settings().whatsapp_number || '01852316348', `${getLang() === 'bn' ? 'আমার অর্ডার নম্বর' : 'My order number'}: ${o.number}`);
  $('#ck-body').innerHTML = `<div class="ok-box" style="grid-column:1/-1">
    <div class="tick" aria-hidden="true">✓</div>
    <h2 id="ck-title" style="padding:0">${esc(t('ok_title'))}</h2>
    <p class="muted" style="margin:0">${esc(t('ok_number'))}</p><div class="onum">${esc(o.number)}</div>
    <p>${esc(t('ok_total'))}: <b>${money(o.total)}</b></p>
    <p class="muted">${esc(v.pay === 'cod' ? t('ok_cod') : t('ok_manual'))}</p>
    ${sent ? `<p class="good">${esc(t('ok_tg_sent'))}</p>` : `<div class="warn">${esc(t('ok_tg_failed'))}</div>`}
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="${esc(wa)}">${esc(t('ok_whatsapp'))}</a>
      <button class="btn btn-primary" type="button" data-act="close-dialog">${esc(t('ok_close'))}</button>
    </div></div>`;
  refresh({ silent: true }); // stock has changed
}

/* ---------------------------------------------------------------- events */
function scrollToShop() { $('#shop').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
function closeNav() { $('#nav').classList.remove('open'); $('#menu-btn').setAttribute('aria-expanded', 'false'); }

document.addEventListener('click', (e) => {
  const dlg = e.target instanceof HTMLDialogElement ? e.target : null;
  if (dlg) { dlg.close(); return; } // backdrop click
  if (e.target.closest('[data-close]')) { e.target.closest('dialog').close(); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.dataset.id; const act = el.dataset.act;
  const pdDlg = $('#product-dialog');
  switch (act) {
    case 'add': addToCart(id); break;
    case 'buy': if (addToCart(id, 1, { silent: true })) openCheckout(); break;
    case 'details': case 'reopen': openDetails(id); break;
    case 'inc': { const l = state.cart.find((x) => x.id === id); if (l) setQty(id, l.qty + 1); break; }
    case 'dec': { const l = state.cart.find((x) => x.id === id); if (l) setQty(id, l.qty - 1); break; }
    case 'remove': setQty(id, 0); break;
    case 'checkout': openCheckout(); break;
    case 'back-cart': $('#checkout-dialog').close(); $('#cart-dialog').showModal(); break;
    case 'close-dialog': el.closest('dialog')?.close(); break;
    case 'reload': state.error = false; renderAll(); refresh({ silent: false }); break;
    case 'clear-filters': state.filter = { q: '', cat: 'all', sort: state.filter.sort }; $('#search-input').value = ''; renderCategories(); renderShop(); break;
    case 'filter-cat':
      e.preventDefault(); state.filter.cat = el.dataset.cat; renderCategories(); renderShop();
      if (el.dataset.scroll) scrollToShop();
      break;
    case 'gallery': {
      const paths = JSON.parse(pdDlg.dataset.imgs || '[]'); const dims = JSON.parse(pdDlg.dataset.w || '[]'); const i = Number(el.dataset.i);
      if (paths[i]) { $('#pd-main').innerHTML = `<img src="${esc(imgUrl(paths[i]))}" width="${dims[i]?.[0] || 1200}" height="${dims[i]?.[1] || 1200}" alt="" decoding="async">`; $$('.thumbs button', pdDlg).forEach((b, k) => b.setAttribute('aria-current', String(k === i))); }
      break;
    }
    case 'pd-inc': { const max = Number(pdDlg.dataset.max); const q = Math.min(max, Number(pdDlg.dataset.qty) + 1); pdDlg.dataset.qty = q; $('#pd-qty').textContent = num(q); break; }
    case 'pd-dec': { const q = Math.max(1, Number(pdDlg.dataset.qty) - 1); pdDlg.dataset.qty = q; $('#pd-qty').textContent = num(q); break; }
    case 'pd-add': addToCart(id, Number(pdDlg.dataset.qty) || 1); break;
    case 'pd-buy': if (addToCart(id, Number(pdDlg.dataset.qty) || 1, { silent: true })) { pdDlg.close(); openCheckout(); } break;
    default: break;
  }
});

function bindStatic() {
  $('#cart-btn').addEventListener('click', () => { renderCart(); $('#cart-dialog').showModal(); });
  $('#menu-btn').addEventListener('click', () => { const open = $('#nav').classList.toggle('open'); $('#menu-btn').setAttribute('aria-expanded', String(open)); });
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) closeNav(); });
  $('#lang-btn').addEventListener('click', () => {
    setLang(getLang() === 'bn' ? 'en' : 'bn'); applyI18n(); delete $('#hero-art').dataset.imgKeep;
    $$('dialog[open]').forEach((d) => d.close()); renderAll();
  });
  const onSearch = debounce(() => { state.filter.q = $('#search-input').value.trim().slice(0, 80); renderShop(); }, 180);
  $('#search-input').addEventListener('input', onSearch);
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); state.filter.q = $('#search-input').value.trim().slice(0, 80); renderShop(); scrollToShop(); closeNav(); $('#search-input').blur(); });
  $('#sort-select').addEventListener('change', (e) => { state.filter.sort = e.target.value; renderShop(); });
  const top = $('#fab-top'); let ticking = false;
  addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { top.hidden = scrollY < 700; ticking = false; }); }, { passive: true });
  top.addEventListener('click', () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));

  // Hidden admin entry: 7 consecutive taps/clicks, each within 1.5s of the previous. Navigation only.
  let taps = 0; let timer;
  $('#secret-tap').addEventListener('click', () => {
    taps += 1; clearTimeout(timer);
    if (taps >= 7) { taps = 0; location.href = '/admin/'; return; }
    timer = setTimeout(() => { taps = 0; }, 1500);
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastFetch > 60000) refresh(); });
  setInterval(() => { if (!document.hidden && Date.now() - state.lastFetch > 90000) refresh(); }, 30000);
}

/** Optional live updates: when the admin changes data in Supabase, refetch immediately. */
async function startRealtime() {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    const sb = createClient(state.cfg.supabaseUrl, state.cfg.supabaseAnonKey, { auth: { persistSession: false } });
    const go = debounce(() => refresh(), 400);
    sb.channel('storefront')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, go)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, go)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, go)
      .subscribe();
  } catch (_) { /* polling/refetch-on-focus still keeps data fresh */ }
}

/* ---------------------------------------------------------------- boot */
async function init() {
  applyI18n(); loadCart(); bindStatic(); renderAll();
  // If the logo failed before this script attached its error handler, show the fallback now.
  for (const id of ['logo-header', 'logo-footer']) { const el = $('#' + id); if (el.complete && el.naturalWidth === 0) el.classList.add('fallback'); }
  try {
    state.cfg = await loadConfig();
  } catch (_) { state.error = true; renderAll(); return; }
  await refresh({ silent: false });
  if (state.loaded) { requestIdleCallback ? requestIdleCallback(startRealtime) : setTimeout(startRealtime, 2000); }
}
init();
