// Nadia Gadget House — admin panel.
// Authentication: Supabase Auth. Authorization: the signed-in user must have a row in public.admin_users,
// and every read/write below is additionally enforced by Row Level Security on the database.
// Seven-tap access on the storefront only navigates here; it grants nothing.
import {
  t, getLang, setLang, applyI18n, esc, money, num, slugify, wordCount, toast, loadConfig,
} from './common.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const BUCKET = 'product-images';
const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

const A = { sb: null, session: null, role: null, tab: 'dashboard', cats: [], editing: null, uploaded: [], removed: [] };

/* ------------------------------------------------------------ utils */
const errMsg = (e) => `${t('a_err')}: ${e?.message || e}`;
const dt = (iso) => new Date(iso).toLocaleString(getLang() === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
const statusLabel = (s) => (getLang() === 'bn' ? { pending: 'পেন্ডিং', confirmed: 'নিশ্চিত', processing: 'প্রসেসিং', shipped: 'পাঠানো হয়েছে', delivered: 'ডেলিভারড', cancelled: 'বাতিল', sent: 'পাঠানো হয়েছে', failed: 'ব্যর্থ' }[s] : null) || s;
const st = (s) => `<span class="st st-${esc(s)}">${esc(statusLabel(s))}</span>`;
const payLabel = (m) => ({ bkash: 'bKash', nagad: 'Nagad', cod: 'COD' }[m] || m);
const dec = (v) => (v === '' || v == null ? null : Number(v));
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function openDialog(html) {
  const d = $('#edit-dialog'); $('#edit-body').innerHTML = html;
  if (!d.open) d.showModal(); d.scrollTop = 0; return d;
}
const closeDialog = () => { const d = $('#edit-dialog'); if (d.open) d.close(); };

/* ------------------------------------------------------------ images: compress → webp, thumb + full */
async function canvasBlob(bitmap, maxW, quality) {
  const scale = Math.min(1, maxW / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale)); const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', quality));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); // browsers without WebP encoding
  return { blob, w, h, canvas: c };
}
const extOf = (blob) => (blob.type === 'image/webp' ? 'webp' : 'jpg');

async function processImage(file, { full = 1200, thumb = 480 } = {}) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('Unsupported image type (use JPG, PNG, WebP or AVIF).');
  if (file.size > 15 * 1024 * 1024) throw new Error('Image is larger than 15 MB.');
  const bitmap = await createImageBitmap(file);
  const f = await canvasBlob(bitmap, full, 0.82);
  const th = await canvasBlob(bitmap, thumb, 0.78);
  const lq = await canvasBlob(bitmap, 24, 0.5);
  const lqip = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(lq.blob); });
  if (bitmap.close) bitmap.close();
  if (f.blob.size > 5 * 1024 * 1024) throw new Error('Optimized image still exceeds the 5 MB limit.');
  return { full: f, thumb: th, lqip };
}

async function uploadImage(folder, file, opts) {
  const p = await processImage(file, opts);
  const base = `${folder}/${rid()}`;
  const up = async (path, b) => {
    const { error } = await A.sb.storage.from(BUCKET).upload(path, b, { cacheControl: '31536000', contentType: b.type, upsert: false });
    if (error) throw error;
  };
  const fullPath = `${base}-full.${extOf(p.full.blob)}`; const thumbPath = `${base}-thumb.${extOf(p.thumb.blob)}`;
  await up(fullPath, p.full.blob);
  try { await up(thumbPath, p.thumb.blob); } catch (e) { await A.sb.storage.from(BUCKET).remove([fullPath]); throw e; }
  A.uploaded.push(fullPath, thumbPath);
  return { path: fullPath, thumb: thumbPath, w: p.full.w, h: p.full.h, tw: p.thumb.w, th: p.thumb.h, lqip: p.lqip };
}
async function removeFiles(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return;
  const { error } = await A.sb.storage.from(BUCKET).remove(list);
  if (error) console.warn('Storage cleanup failed:', error.message);
}

/* ------------------------------------------------------------ auth & boot */
async function boot() {
  applyI18n(); bindChrome();
  try {
    const cfg = await loadConfig();
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    A.sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (e) {
    $('#boot-loading').hidden = true; const b = $('#boot-error'); b.hidden = false;
    b.textContent = 'Could not load the admin panel. The store may not be configured yet (see docs/DEPLOYMENT.md).'; return;
  }
  const { data } = await A.sb.auth.getSession();
  A.sb.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT') { A.session = null; showLogin(); } else if (s) A.session = s; });
  $('#boot-loading').hidden = true;
  if (data.session) await enter(data.session); else showLogin();
}
function showLogin(msg) {
  $('#app-view').hidden = true; $('#login-view').hidden = false; $('#logout-btn').hidden = true;
  const e = $('#login-error'); e.hidden = !msg; e.textContent = msg || '';
}
async function enter(session) {
  A.session = session;
  const { data, error } = await A.sb.from('admin_users').select('role').eq('user_id', session.user.id).maybeSingle();
  if (error || !data) { await A.sb.auth.signOut(); showLogin(t('a_not_authorized')); return; }
  A.role = data.role;
  $('#login-view').hidden = true; $('#app-view').hidden = false; $('#logout-btn').hidden = false;
  await loadCats();
  go(A.tab);
}
async function loadCats() {
  const { data } = await A.sb.from('categories').select('*').order('sort_order').order('name');
  A.cats = data || [];
}

function bindChrome() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn'); btn.disabled = true;
    const { data, error } = await A.sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
    btn.disabled = false;
    if (error) { showLogin(error.message); return; }
    $('#l-pass').value = '';
    await enter(data.session);
  });
  $('#logout-btn').addEventListener('click', async () => { await A.sb.auth.signOut(); });
  $('#lang-btn').addEventListener('click', () => { setLang(getLang() === 'bn' ? 'en' : 'bn'); applyI18n(); $('#lang-btn').textContent = getLang() === 'bn' ? 'English' : 'বাংলা'; closeDialog(); if (A.session) go(A.tab); });
  $('#lang-btn').textContent = getLang() === 'bn' ? 'English' : 'বাংলা';
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
  $('#edit-dialog').addEventListener('click', (e) => { if (e.target.hasAttribute('data-close') || e.target.closest('[data-close]')) closeDialog(); });
  $('#edit-dialog').addEventListener('close', cleanupAbandonedUploads);
}
async function cleanupAbandonedUploads() {
  if (A.uploaded.length) { const orphan = A.uploaded.slice(); A.uploaded = []; await removeFiles(orphan); }
  A.removed = []; A.editing = null;
}

function go(tab) {
  A.tab = tab;
  $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const view = $('#view'); view.innerHTML = `<p class="muted">${esc(t('loading'))}</p>`;
  ({ dashboard: viewDashboard, products: viewProducts, categories: viewCategories, orders: viewOrders, settings: viewSettings }[tab] || viewDashboard)().catch((e) => { view.innerHTML = `<div class="form-error">${esc(errMsg(e))}</div>`; });
}

/* ------------------------------------------------------------ dashboard */
async function count(table, apply) {
  let q = A.sb.from(table).select('id', { count: 'exact', head: true }); if (apply) q = apply(q);
  const { count: n, error } = await q; if (error) throw error; return n || 0;
}
async function viewDashboard() {
  const [prod, cats, orders, pending, done, recent] = await Promise.all([
    count('products'), count('categories'), count('orders'), count('orders', (q) => q.eq('status', 'pending')), count('orders', (q) => q.eq('status', 'delivered')),
    A.sb.from('orders').select('id,order_number,customer_name,total,status,telegram_status,created_at').order('created_at', { ascending: false }).limit(8),
  ]);
  if (recent.error) throw recent.error;
  const stat = (n, k) => `<div class="stat"><b>${num(n)}</b><span>${esc(t(k))}</span></div>`;
  $('#view').innerHTML = `<div class="stats">${stat(prod, 'a_total_products')}${stat(orders, 'a_total_orders')}${stat(pending, 'a_pending')}${stat(done, 'a_completed')}${stat(cats, 'a_total_cats')}</div>
    <h2>${esc(t('a_recent'))}</h2>${ordersTable(recent.data)}`;
}
function ordersTable(rows) {
  if (!rows.length) return `<p class="muted">${esc(t('a_none'))}</p>`;
  return `<div class="tscroll"><table class="atable"><thead><tr><th>#</th><th>${esc(t('a_customer'))}</th><th>${esc(t('total'))}</th><th>${esc(t('a_status'))}</th><th>${esc(t('a_tg'))}</th><th>${esc(t('a_date'))}</th><th></th></tr></thead><tbody>
    ${rows.map((o) => `<tr><td><b>${esc(o.order_number)}</b></td><td>${esc(o.customer_name)}</td><td>${money(o.total)}</td><td>${st(o.status)}</td><td>${st(o.telegram_status)}</td><td>${esc(dt(o.created_at))}</td><td><button class="btn btn-ghost btn-sm" type="button" data-order="${esc(o.id)}">${esc(t('a_view'))}</button></td></tr>`).join('')}
    </tbody></table></div>`;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-order]'); if (b) openOrder(b.dataset.order); });

/* ------------------------------------------------------------ products */
async function viewProducts() {
  const { data, error } = await A.sb.from('products').select('id,name,name_bn,regular_price,discount_price,stock_quantity,is_available,is_featured,is_new_arrival,is_sample,category_id,images,updated_at').order('created_at', { ascending: false });
  if (error) throw error;
  const catName = (id) => A.cats.find((c) => c.id === id)?.name || '—';
  const draw = (q = '') => {
    const rows = data.filter((p) => !q || `${p.name} ${p.name_bn || ''}`.toLowerCase().includes(q.toLowerCase()));
    $('#p-rows').innerHTML = rows.length ? rows.map((p) => {
      const im = p.images?.[0];
      return `<tr><td>${im ? `<img class="thumb-sm" src="/img/${esc(im.thumb || im.path)}" width="44" height="44" alt="" loading="lazy">` : '<div class="thumb-sm"></div>'}</td>
      <td><b>${esc(p.name)}</b>${p.is_sample ? ` <span class="st st-pending">${esc(t('badge_sample'))}</span>` : ''}<br><small class="muted">${esc(catName(p.category_id))}</small></td>
      <td>${money(p.discount_price ?? p.regular_price)}${p.discount_price != null ? `<br><small class="muted"><s>${money(p.regular_price)}</s></small>` : ''}</td>
      <td>${num(p.stock_quantity)}${p.is_available ? '' : ' ⛔'}</td>
      <td>${p.is_featured ? '★ ' : ''}${p.is_new_arrival ? 'NEW' : ''}</td>
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" type="button" data-edit="${esc(p.id)}">${esc(t('a_edit'))}</button><button class="btn btn-danger btn-sm" type="button" data-del="${esc(p.id)}">${esc(t('a_delete'))}</button></div></td></tr>`;
    }).join('') : `<tr><td colspan="6" class="muted">${esc(t('a_none'))}</td></tr>`;
  };
  $('#view').innerHTML = `<div class="bar"><div class="grow"><input id="p-search" type="search" placeholder="${esc(t('a_search'))}" aria-label="${esc(t('a_search'))}"></div><button class="btn btn-primary" type="button" id="p-add">+ ${esc(t('a_add'))}</button></div>
    <div class="tscroll"><table class="atable"><thead><tr><th></th><th>${esc(t('a_name'))}</th><th>${esc(t('total'))}</th><th>${esc(t('a_stock'))}</th><th></th><th></th></tr></thead><tbody id="p-rows"></tbody></table></div>`;
  draw();
  $('#p-search').addEventListener('input', (e) => draw(e.target.value.trim()));
  $('#p-add').addEventListener('click', () => productEditor(null));
  $('#p-rows').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); const del = e.target.closest('[data-del]');
    if (ed) productEditor(ed.dataset.edit);
    if (del && confirm(t('a_confirm_delete'))) {
      del.disabled = true;
      try {
        const { data: row } = await A.sb.from('products').select('images').eq('id', del.dataset.del).single();
        const { error: de } = await A.sb.from('products').delete().eq('id', del.dataset.del);
        if (de) throw de;
        await removeFiles((row?.images || []).flatMap((i) => [i.path, i.thumb]));
        toast(t('a_deleted'), 'ok'); go('products');
      } catch (er) { del.disabled = false; toast(errMsg(er), 'error'); }
    }
  });
}

async function productEditor(id) {
  let p = { name: '', name_bn: '', short_description: '', short_description_bn: '', description: '', description_bn: '', regular_price: '', discount_price: null, category_id: A.cats[0]?.id || '', images: [], specifications: [], stock_quantity: 0, is_available: true, is_featured: false, is_new_arrival: false, is_sample: false };
  if (id) {
    const { data, error } = await A.sb.from('products').select('*').eq('id', id).single(); // full description loaded here
    if (error) { toast(errMsg(error), 'error'); return; }
    p = data;
  }
  A.editing = { id, images: (p.images || []).slice(), specs: (p.specifications || []).map((s) => ({ ...s })), original: (p.images || []).map((i) => [i.path, i.thumb]).flat() };
  A.uploaded = []; A.removed = [];
  const catOpts = A.cats.map((c) => `<option value="${esc(c.id)}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  openDialog(`<form class="form-grid two" id="p-form" novalidate>
    <h2 id="edit-title" class="span2">${esc(id ? t('a_edit') : t('a_add'))} — ${esc(t('a_products'))}</h2>
    <div id="p-error" class="form-error span2" role="alert" hidden></div>
    <div class="field"><label for="p-name">${esc(t('a_name'))} *</label><input id="p-name" maxlength="200" value="${esc(p.name)}" required></div>
    <div class="field"><label for="p-name-bn">${esc(t('a_name_bn'))}</label><input id="p-name-bn" maxlength="200" value="${esc(p.name_bn || '')}"></div>
    <div class="field"><label for="p-short">${esc(t('a_short'))}</label><input id="p-short" maxlength="300" value="${esc(p.short_description || '')}"></div>
    <div class="field"><label for="p-short-bn">${esc(t('a_short_bn'))}</label><input id="p-short-bn" maxlength="300" value="${esc(p.short_description_bn || '')}"></div>
    <div class="field"><label for="p-reg">${esc(t('a_regular'))} *</label><input id="p-reg" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(p.regular_price)}" required></div>
    <div class="field"><label for="p-disc">${esc(t('a_discount'))}</label><input id="p-disc" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(p.discount_price ?? '')}"></div>
    <div class="field"><label for="p-cat">${esc(t('a_category'))}</label><select id="p-cat"><option value="">—</option>${catOpts}</select></div>
    <div class="field"><label for="p-stock">${esc(t('a_stock'))}</label><input id="p-stock" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.stock_quantity)}"></div>
    <div class="checks span2">
      <label><input type="checkbox" id="p-avail" ${p.is_available ? 'checked' : ''}> ${esc(t('a_available'))}</label>
      <label><input type="checkbox" id="p-feat" ${p.is_featured ? 'checked' : ''}> ${esc(t('a_featured'))}</label>
      <label><input type="checkbox" id="p-new" ${p.is_new_arrival ? 'checked' : ''}> ${esc(t('a_new'))}</label>
      <label><input type="checkbox" id="p-sample" ${p.is_sample ? 'checked' : ''}> ${esc(t('a_sample'))}</label>
    </div>
    <div class="field span2"><label for="p-desc">${esc(t('a_desc'))}</label>
      <textarea id="p-desc" class="long" spellcheck="true" placeholder="Paragraphs, ## headings, - bullet lists, **bold**…">${esc(p.description || '')}</textarea>
      <div class="counter"><span id="c-desc"></span><span class="muted">## Heading · - list · **bold**</span></div></div>
    <div class="field span2"><label for="p-desc-bn">${esc(t('a_desc_bn'))}</label>
      <textarea id="p-desc-bn" class="long" style="min-height:260px" spellcheck="false">${esc(p.description_bn || '')}</textarea>
      <div class="counter"><span id="c-desc-bn"></span></div></div>
    <div class="field span2"><label>${esc(t('a_specs'))}</label><div id="specs"></div><button class="btn btn-ghost btn-sm" type="button" id="spec-add">+ ${esc(t('a_add_spec'))}</button></div>
    <div class="field span2"><label>${esc(t('a_images'))}</label><div class="img-grid" id="imgs"></div>
      <input type="file" id="img-file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden>
      <div><button class="btn btn-ghost btn-sm" type="button" id="img-add">${esc(t('a_upload'))}</button> <span class="muted small" id="img-status"></span></div></div>
    <div class="bar-actions span2"><button class="btn btn-primary" type="submit" id="p-save">${esc(t('a_save'))}</button><button class="btn btn-ghost" type="button" data-close>${esc(t('a_cancel'))}</button></div>
  </form>`);
  const upd = (ta, out) => { const w = wordCount(ta.value); $(out).textContent = `${t('a_words', { n: num(w) })} · ${t('a_chars', { n: num(ta.value.length) })}`; };
  for (const [ta, out] of [['#p-desc', '#c-desc'], ['#p-desc-bn', '#c-desc-bn']]) { const el = $(ta); upd(el, out); el.addEventListener('input', () => upd(el, out)); }
  drawSpecs(); drawImgs();
  $('#spec-add').addEventListener('click', () => { A.editing.specs.push({ label: '', label_bn: '', value: '' }); drawSpecs(); });
  $('#img-add').addEventListener('click', () => $('#img-file').click());
  $('#img-file').addEventListener('change', onPickImages);
  $('#p-form').addEventListener('submit', saveProduct);
}
function drawSpecs() {
  const box = $('#specs'); if (!box) return;
  box.innerHTML = A.editing.specs.map((s, i) => `<div class="spec-row">
    <input data-k="label" data-i="${i}" value="${esc(s.label)}" placeholder="${esc(t('a_spec_label'))}" aria-label="${esc(t('a_spec_label'))}">
    <input data-k="label_bn" data-i="${i}" value="${esc(s.label_bn || '')}" placeholder="${esc(t('a_spec_label_bn'))}" aria-label="${esc(t('a_spec_label_bn'))}">
    <input data-k="value" data-i="${i}" value="${esc(s.value)}" placeholder="${esc(t('a_spec_value'))}" aria-label="${esc(t('a_spec_value'))}">
    <button class="btn btn-danger btn-sm" type="button" data-spec-del="${i}" aria-label="${esc(t('a_delete'))}">✕</button></div>`).join('');
  box.oninput = (e) => { const i = e.target.dataset.i; if (i != null) A.editing.specs[i][e.target.dataset.k] = e.target.value; };
  box.onclick = (e) => { const d = e.target.closest('[data-spec-del]'); if (d) { A.editing.specs.splice(Number(d.dataset.specDel), 1); drawSpecs(); } };
}
function drawImgs() {
  const box = $('#imgs'); if (!box) return;
  box.innerHTML = A.editing.images.map((im, i) => `<div class="img-tile ${i === 0 ? 'cover' : ''}"><img src="/img/${esc(im.thumb || im.path)}" alt="" width="110" height="110">
    <div class="ctl">${i === 0 ? `<button type="button" disabled>${esc(t('a_cover'))}</button>` : `<button type="button" data-cover="${i}">${esc(t('a_make_cover'))}</button>`}<button type="button" data-rm="${i}" aria-label="${esc(t('a_delete'))}">✕</button></div></div>`).join('');
  box.onclick = (e) => {
    const c = e.target.closest('[data-cover]'); const r = e.target.closest('[data-rm]');
    if (c) { const [im] = A.editing.images.splice(Number(c.dataset.cover), 1); A.editing.images.unshift(im); drawImgs(); }
    if (r) { const [im] = A.editing.images.splice(Number(r.dataset.rm), 1); A.removed.push(im.path, im.thumb); drawImgs(); }
  };
}
async function onPickImages(e) {
  const files = [...e.target.files]; e.target.value = '';
  const status = $('#img-status');
  for (const f of files) {
    try {
      status.textContent = t('a_uploading');
      A.editing.images.push(await uploadImage('products', f)); drawImgs();
    } catch (er) { toast(errMsg(er), 'error'); }
  }
  status.textContent = '';
}
const perr = (m) => { const e = $('#p-error'); e.hidden = !m; e.textContent = m || ''; if (m) e.scrollIntoView({ block: 'center' }); };

async function saveProduct(ev) {
  ev.preventDefault(); perr('');
  const name = $('#p-name').value.trim(); const reg = dec($('#p-reg').value); const disc = dec($('#p-disc').value);
  const stock = $('#p-stock').value === '' ? 0 : Number($('#p-stock').value);
  if (!name || reg == null || Number.isNaN(reg) || reg < 0) return perr(t('a_err_required'));
  if (disc != null && (Number.isNaN(disc) || disc < 0 || disc >= reg)) return perr(t('a_err_price'));
  if (!Number.isInteger(stock) || stock < 0) return perr(t('a_err_required'));
  const row = {
    name, name_bn: $('#p-name-bn').value.trim() || null, short_description: $('#p-short').value.trim() || null, short_description_bn: $('#p-short-bn').value.trim() || null,
    description: $('#p-desc').value, description_bn: $('#p-desc-bn').value || null, // never trimmed/truncated: stored as typed
    regular_price: reg, discount_price: disc, category_id: $('#p-cat').value || null, stock_quantity: stock,
    is_available: $('#p-avail').checked, is_featured: $('#p-feat').checked, is_new_arrival: $('#p-new').checked, is_sample: $('#p-sample').checked,
    images: A.editing.images, specifications: A.editing.specs.filter((s) => s.label.trim() && String(s.value).trim()).map((s) => ({ label: s.label.trim(), label_bn: (s.label_bn || '').trim() || undefined, value: String(s.value).trim() })),
  };
  const btn = $('#p-save'); btn.disabled = true; btn.textContent = t('a_saving');
  try {
    let error;
    if (A.editing.id) ({ error } = await A.sb.from('products').update(row).eq('id', A.editing.id));
    else {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        ({ error } = await A.sb.from('products').insert({ ...row, slug: `${slugify(name)}-${rid().slice(0, 6)}` }));
        if (!error || error.code !== '23505') break;
      }
    }
    if (error) throw error;
    // Saved: the removed images can now be deleted, and uploaded ones are no longer orphans.
    await removeFiles(A.removed); A.removed = []; A.uploaded = [];
    toast(t('a_saved'), 'ok'); closeDialog(); go('products');
  } catch (er) { perr(errMsg(er)); btn.disabled = false; btn.textContent = t('a_save'); }
}

/* ------------------------------------------------------------ categories */
async function viewCategories() {
  await loadCats();
  const { data: prods } = await A.sb.from('products').select('category_id');
  const used = {}; (prods || []).forEach((p) => { if (p.category_id) used[p.category_id] = (used[p.category_id] || 0) + 1; });
  $('#view').innerHTML = `<div class="bar"><span></span><button class="btn btn-primary" type="button" id="c-add">+ ${esc(t('a_add'))}</button></div>
    <div class="tscroll"><table class="atable"><thead><tr><th>${esc(t('a_image'))}</th><th>${esc(t('a_name'))}</th><th>${esc(t('a_products'))}</th><th>${esc(t('a_visible'))}</th><th></th></tr></thead><tbody>
    ${A.cats.length ? A.cats.map((c) => `<tr><td>${c.image_path ? `<img class="thumb-sm" src="/img/${esc(c.image_path)}" width="44" height="44" alt="">` : '<div class="thumb-sm"></div>'}</td><td><b>${esc(c.name)}</b>${c.name_bn ? `<br><small class="muted">${esc(c.name_bn)}</small>` : ''}</td><td>${num(used[c.id] || 0)}</td><td>${c.is_visible ? '✓' : '—'}</td>
    <td><div class="row-actions"><button class="btn btn-ghost btn-sm" type="button" data-cedit="${esc(c.id)}">${esc(t('a_edit'))}</button><button class="btn btn-danger btn-sm" type="button" data-cdel="${esc(c.id)}" data-n="${used[c.id] || 0}">${esc(t('a_delete'))}</button></div></td></tr>`).join('') : `<tr><td colspan="5" class="muted">${esc(t('a_none'))}</td></tr>`}
    </tbody></table></div>`;
  $('#c-add').addEventListener('click', () => categoryEditor(null));
  $('#view').onclick = async (e) => {
    const ed = e.target.closest('[data-cedit]'); const del = e.target.closest('[data-cdel]');
    if (ed) categoryEditor(ed.dataset.cedit);
    if (del) {
      const n = Number(del.dataset.n);
      if (n > 0) { toast(t('a_cat_in_use', { n: num(n) }), 'error'); return; } // reassign products first
      if (!confirm(t('a_confirm_delete'))) return;
      const cat = A.cats.find((c) => c.id === del.dataset.cdel);
      const { error } = await A.sb.from('categories').delete().eq('id', del.dataset.cdel);
      if (error) { toast(error.code === '23503' ? t('a_cat_in_use', { n: '' }) : errMsg(error), 'error'); return; }
      if (cat?.image_path) await removeFiles([cat.image_path]);
      toast(t('a_deleted'), 'ok'); go('categories');
    }
  };
}
function categoryEditor(id) {
  const c = id ? A.cats.find((x) => x.id === id) : { name: '', name_bn: '', description: '', image_path: null, is_visible: true, sort_order: A.cats.length + 1 };
  A.editing = { id, image: c.image_path, oldImage: c.image_path }; A.uploaded = []; A.removed = [];
  openDialog(`<form class="form-grid two" id="c-form" novalidate>
    <h2 id="edit-title" class="span2">${esc(id ? t('a_edit') : t('a_add'))} — ${esc(t('a_categories'))}</h2>
    <div id="c-error" class="form-error span2" role="alert" hidden></div>
    <div class="field"><label for="c-name">${esc(t('a_name'))} *</label><input id="c-name" maxlength="120" value="${esc(c.name)}" required></div>
    <div class="field"><label for="c-name-bn">${esc(t('a_name_bn'))}</label><input id="c-name-bn" maxlength="120" value="${esc(c.name_bn || '')}"></div>
    <div class="field span2"><label for="c-desc">${esc(t('a_description'))}</label><textarea id="c-desc" class="mid">${esc(c.description || '')}</textarea></div>
    <div class="field"><label for="c-sort">${esc(t('a_sort'))}</label><input id="c-sort" type="number" step="1" value="${esc(c.sort_order)}"></div>
    <div class="checks"><label><input type="checkbox" id="c-vis" ${c.is_visible ? 'checked' : ''}> ${esc(t('a_visible'))}</label></div>
    <div class="field span2"><label>${esc(t('a_image'))}</label><div id="c-img"></div><input type="file" id="c-file" accept="image/jpeg,image/png,image/webp,image/avif" hidden>
      <div><button class="btn btn-ghost btn-sm" type="button" id="c-pick">${esc(t('a_upload'))}</button> <span class="muted small" id="c-status"></span></div></div>
    <div class="bar-actions span2"><button class="btn btn-primary" type="submit" id="c-save">${esc(t('a_save'))}</button><button class="btn btn-ghost" type="button" data-close>${esc(t('a_cancel'))}</button></div></form>`);
  const draw = () => { $('#c-img').innerHTML = A.editing.image ? `<img class="thumb-sm" style="width:120px;height:90px" src="/img/${esc(A.editing.image)}" alt="">` : ''; };
  draw();
  $('#c-pick').addEventListener('click', () => $('#c-file').click());
  $('#c-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { $('#c-status').textContent = t('a_uploading'); const r = await uploadImage('categories', f, { full: 800, thumb: 200 }); A.editing.image = r.path; if (r.thumb) A.removed.push(r.thumb); draw(); }
    catch (er) { toast(errMsg(er), 'error'); } finally { $('#c-status').textContent = ''; }
  });
  $('#c-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = (m) => { const e = $('#c-error'); e.hidden = !m; e.textContent = m || ''; };
    const name = $('#c-name').value.trim(); if (!name) return err(t('a_err_required'));
    const row = { name, name_bn: $('#c-name-bn').value.trim() || null, description: $('#c-desc').value.trim() || null, sort_order: Number($('#c-sort').value) || 0, is_visible: $('#c-vis').checked, image_path: A.editing.image || null };
    const btn = $('#c-save'); btn.disabled = true;
    let error;
    if (id) ({ error } = await A.sb.from('categories').update(row).eq('id', id));
    else for (let i = 0; i < 3; i += 1) { ({ error } = await A.sb.from('categories').insert({ ...row, slug: `${slugify(name)}-${rid().slice(0, 4)}` })); if (!error || error.code !== '23505') break; }
    if (error) { btn.disabled = false; return err(errMsg(error)); }
    // Only the full-size image is used for categories: delete every other upload (thumbs, replaced or
    // superseded images) and the previously saved image if it was replaced.
    const keep = A.editing.image;
    const stale = A.uploaded.filter((p) => p !== keep);
    if (A.editing.oldImage && A.editing.oldImage !== keep) stale.push(A.editing.oldImage, A.editing.oldImage.replace('-full.', '-thumb.'));
    A.uploaded = []; await removeFiles(stale); A.removed = [];
    toast(t('a_saved'), 'ok'); closeDialog(); go('categories');
  });
}

/* ------------------------------------------------------------ orders */
async function viewOrders() {
  $('#view').innerHTML = `<div class="bar"><div class="grow"><input id="o-search" type="search" placeholder="${esc(t('a_search'))} (#, name, phone)" aria-label="${esc(t('a_search'))}"><select id="o-status" aria-label="${esc(t('a_status'))}"><option value="">${esc(t('a_all'))}</option>${ORDER_STATUSES.map((s) => `<option value="${s}">${esc(statusLabel(s))}</option>`).join('')}</select></div></div><div id="o-list"></div>`;
  const load = async () => {
    let q = A.sb.from('orders').select('id,order_number,customer_name,phone,total,status,telegram_status,created_at').order('created_at', { ascending: false }).limit(200);
    const status = $('#o-status').value; if (status) q = q.eq('status', status);
    const term = $('#o-search').value.trim().replace(/[%,()]/g, '');
    if (term) q = q.or(`order_number.ilike.%${term}%,customer_name.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data, error } = await q; if (error) { $('#o-list').innerHTML = `<div class="form-error">${esc(errMsg(error))}</div>`; return; }
    $('#o-list').innerHTML = ordersTable(data);
  };
  let h; $('#o-search').addEventListener('input', () => { clearTimeout(h); h = setTimeout(load, 300); });
  $('#o-status').addEventListener('change', load);
  await load();
}
async function openOrder(id) {
  const { data: o, error } = await A.sb.from('orders').select('*, order_items(*)').eq('id', id).single();
  if (error) { toast(errMsg(error), 'error'); return; }
  openDialog(`<div class="form-grid"><h2 id="edit-title">${esc(o.order_number)}</h2>
    <dl class="dl"><dt>${esc(t('a_status'))}</dt><dd><select id="o-st" aria-label="${esc(t('a_status'))}">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${esc(statusLabel(s))}</option>`).join('')}</select> <button class="btn btn-primary btn-sm" type="button" id="o-st-save">${esc(t('a_save'))}</button></dd>
    <dt>${esc(t('a_date'))}</dt><dd>${esc(dt(o.created_at))}</dd>
    <dt>${esc(t('a_customer'))}</dt><dd>${esc(o.customer_name)}<br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></dd>
    <dt>${esc(t('ck_address'))}</dt><dd>${esc(o.address)}, ${esc(o.district)}</dd>
    <dt>${esc(t('a_payment'))}</dt><dd>${esc(payLabel(o.payment_method))}${o.transaction_reference ? ` — ${esc(t('a_trx'))}: <code>${esc(o.transaction_reference)}</code> <span class="muted small">(manual verification)</span>` : ''}</dd>
    ${o.notes ? `<dt>${esc(t('a_notes'))}</dt><dd>${esc(o.notes)}</dd>` : ''}
    <dt>${esc(t('a_tg'))}</dt><dd>${st(o.telegram_status)} ${o.telegram_error ? `<small class="muted">${esc(o.telegram_error)}</small>` : ''} ${o.telegram_status !== 'sent' ? `<button class="btn btn-ghost btn-sm" type="button" id="o-retry">${esc(t('a_retry_tg'))}</button>` : ''}</dd></dl>
    <h3>${esc(t('a_items'))}</h3>
    <div class="tscroll"><table class="atable" style="min-width:0"><tbody>${o.order_items.map((i) => `<tr><td>${esc(i.product_name)}</td><td>${money(i.unit_price)} × ${num(i.quantity)}</td><td><b>${money(i.total_price)}</b></td></tr>`).join('')}
    <tr><td colspan="2">${esc(t('subtotal'))}</td><td>${money(o.subtotal)}</td></tr><tr><td colspan="2">${esc(t('delivery'))}</td><td>${money(o.delivery_charge)}</td></tr><tr><td colspan="2"><b>${esc(t('total'))}</b></td><td><b>${money(o.total)}</b></td></tr></tbody></table></div>
    <div class="bar-actions"><button class="btn btn-ghost" type="button" data-close>${esc(t('close'))}</button></div></div>`);
  $('#o-st-save').addEventListener('click', async () => {
    const { error: e } = await A.sb.from('orders').update({ status: $('#o-st').value }).eq('id', id);
    if (e) { toast(e.message.includes('CANCELLED_ORDER_LOCKED') ? 'Cancelled orders cannot be re-opened.' : errMsg(e), 'error'); return; }
    toast(t('a_saved'), 'ok'); closeDialog(); go(A.tab);
  });
  $('#o-retry')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      const { data: s } = await A.sb.auth.getSession();
      const res = await fetch('/api/retry-telegram', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session.access_token}` }, body: JSON.stringify({ order_id: id }) });
      const r = await res.json().catch(() => ({}));
      toast(r.ok ? 'Telegram: sent' : `Telegram: ${r.error || 'failed'}`, r.ok ? 'ok' : 'error');
      if (r.ok) { closeDialog(); go(A.tab); } else ev.target.disabled = false;
    } catch (er) { ev.target.disabled = false; toast(errMsg(er), 'error'); }
  });
}

/* ------------------------------------------------------------ settings */
async function viewSettings() {
  const { data: s, error } = await A.sb.from('store_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  const b = s.homepage_banner || {}; const pi = s.payment_instructions || {};
  const ro = A.role === 'owner' ? '' : 'disabled';
  const f = (id, label, val, extra = '') => `<div class="field"><label for="${id}">${esc(t(label))}</label><input id="${id}" value="${esc(val ?? '')}" ${extra} ${ro}></div>`;
  const ta = (id, label, val) => `<div class="field span2"><label for="${id}">${esc(label)}</label><textarea id="${id}" class="mid" ${ro}>${esc(val ?? '')}</textarea></div>`;
  A.editing = { bannerImg: b.image_path || null, bannerW: b.image_w, bannerH: b.image_h, oldBanner: b.image_path || null }; A.uploaded = [];
  $('#view').innerHTML = `${A.role === 'owner' ? '' : `<div class="form-error">${esc(t('a_owner_only'))}</div>`}
  <form class="form-grid two card-glass" id="s-form" novalidate><div id="s-error" class="form-error span2" role="alert" hidden></div>
    ${f('s-name', 'a_store_name', s.store_name)}${f('s-name-bn', 'a_store_name_bn', s.store_name_bn)}${f('s-tag', 'a_tagline', s.tagline)}${f('s-tag-bn', 'a_tagline_bn', s.tagline_bn)}
    ${f('s-wa', 'a_whatsapp', s.whatsapp_number, 'inputmode="tel"')}${f('s-phone', 'a_phone', s.contact_phone, 'inputmode="tel"')}${f('s-email', 'a_email_c', s.contact_email, 'type="email"')}${f('s-fb', 'a_facebook', s.facebook_url, 'type="url"')}
    ${f('s-addr', 'a_address', s.address)}${f('s-addr-bn', 'a_address', s.address_bn)}
    ${f('s-din', 'a_del_in', s.delivery_inside_dhaka, 'type="number" min="0" step="1"')}${f('s-dout', 'a_del_out', s.delivery_outside_dhaka, 'type="number" min="0" step="1"')}
    ${f('s-bkash', 'a_bkash', s.bkash_number, 'inputmode="tel"')}${f('s-nagad', 'a_nagad', s.nagad_number, 'inputmode="tel"')}
    <h3 class="span2">${esc(t('a_pay_ins'))}</h3>
    ${ta('s-pi-bkash-en', 'bKash (EN)', pi.bkash?.en)}${ta('s-pi-bkash-bn', 'bKash (BN)', pi.bkash?.bn)}${ta('s-pi-nagad-en', 'Nagad (EN)', pi.nagad?.en)}${ta('s-pi-nagad-bn', 'Nagad (BN)', pi.nagad?.bn)}${ta('s-pi-cod-en', 'COD (EN)', pi.cod?.en)}${ta('s-pi-cod-bn', 'COD (BN)', pi.cod?.bn)}
    <h3 class="span2">${esc(t('a_banner'))}</h3>
    ${f('s-b-badge', 'a_b_badge', b.badge)}${f('s-b-badge-bn', 'a_b_badge', b.badge_bn)}${f('s-b-title', 'a_b_title', b.title)}${f('s-b-title-bn', 'a_b_title', b.title_bn)}
    ${ta('s-b-sub', `${t('a_b_sub')} (EN)`, b.subtitle)}${ta('s-b-sub-bn', `${t('a_b_sub')} (BN)`, b.subtitle_bn)}
    <div class="field span2"><label>${esc(t('a_b_image'))}</label><div id="s-b-prev"></div><input type="file" id="s-b-file" accept="image/jpeg,image/png,image/webp,image/avif" hidden>
      <div><button class="btn btn-ghost btn-sm" type="button" id="s-b-pick" ${ro}>${esc(t('a_upload'))}</button> <button class="btn btn-ghost btn-sm" type="button" id="s-b-clear" ${ro}>${esc(t('remove'))}</button> <span class="muted small" id="s-b-status"></span></div></div>
    <div class="bar-actions span2"><button class="btn btn-primary" type="submit" id="s-save" ${ro}>${esc(t('a_save'))}</button></div></form>`;
  const prev = () => { $('#s-b-prev').innerHTML = A.editing.bannerImg ? `<img class="thumb-sm" style="width:200px;height:auto;aspect-ratio:3/2" src="/img/${esc(A.editing.bannerImg)}" alt="">` : ''; }; prev();
  $('#s-b-pick').addEventListener('click', () => $('#s-b-file').click());
  $('#s-b-clear').addEventListener('click', () => { A.editing.bannerImg = null; prev(); });
  $('#s-b-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try { $('#s-b-status').textContent = t('a_uploading'); const r = await uploadImage('banners', file, { full: 1600, thumb: 400 }); A.editing.bannerImg = r.path; A.editing.bannerW = r.w; A.editing.bannerH = r.h; prev(); }
    catch (er) { toast(errMsg(er), 'error'); } finally { $('#s-b-status').textContent = ''; }
  });
  $('#s-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = (id) => $('#' + id).value.trim();
    const din = Number(v('s-din')); const dout = Number(v('s-dout'));
    const err = (m) => { const e = $('#s-error'); e.hidden = !m; e.textContent = m || ''; };
    if (!v('s-name') || !(din >= 0) || !(dout >= 0)) return err(t('a_err_required'));
    const row = {
      store_name: v('s-name'), store_name_bn: v('s-name-bn') || v('s-name'), tagline: v('s-tag'), tagline_bn: v('s-tag-bn'),
      whatsapp_number: v('s-wa'), contact_phone: v('s-phone'), contact_email: v('s-email') || null, facebook_url: v('s-fb') || null, address: v('s-addr') || null, address_bn: v('s-addr-bn') || null,
      delivery_inside_dhaka: din, delivery_outside_dhaka: dout, bkash_number: v('s-bkash') || null, nagad_number: v('s-nagad') || null,
      payment_instructions: { bkash: { en: v('s-pi-bkash-en'), bn: v('s-pi-bkash-bn') }, nagad: { en: v('s-pi-nagad-en'), bn: v('s-pi-nagad-bn') }, cod: { en: v('s-pi-cod-en'), bn: v('s-pi-cod-bn') } },
      homepage_banner: { badge: v('s-b-badge'), badge_bn: v('s-b-badge-bn'), title: v('s-b-title'), title_bn: v('s-b-title-bn'), subtitle: v('s-b-sub'), subtitle_bn: v('s-b-sub-bn'), image_path: A.editing.bannerImg, image_w: A.editing.bannerW || null, image_h: A.editing.bannerH || null },
    };
    const btn = $('#s-save'); btn.disabled = true; btn.textContent = t('a_saving');
    const { data, error: e2 } = await A.sb.from('store_settings').update(row).eq('id', 1).select('id');
    btn.disabled = false; btn.textContent = t('a_save');
    if (e2 || !data?.length) return err(e2 ? errMsg(e2) : t('a_owner_only')); // RLS: only owners can update
    const stale = A.uploaded.filter((p) => p !== A.editing.bannerImg); // thumbs / superseded uploads
    if (A.editing.oldBanner && A.editing.oldBanner !== A.editing.bannerImg) stale.push(A.editing.oldBanner, A.editing.oldBanner.replace('-full.', '-thumb.'));
    A.uploaded = []; await removeFiles(stale); A.editing.oldBanner = A.editing.bannerImg;
    err(''); toast(t('a_saved'), 'ok');
  });
}

boot();
