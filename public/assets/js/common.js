// Shared helpers for the storefront and the admin panel.
import { DICT } from './i18n.js';

let lang = 'en';
try {
  const saved = localStorage.getItem('ngh_lang');
  lang = saved === 'bn' || saved === 'en' ? saved : (navigator.language || '').toLowerCase().startsWith('bn') ? 'bn' : 'en';
} catch (_) { /* storage blocked */ }

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'bn' ? 'bn' : 'en';
  try { localStorage.setItem('ngh_lang', lang); } catch (_) { /* ignore */ }
  document.documentElement.lang = lang;
}
document.documentElement.lang = lang;

export function t(key, vars) {
  let s = (DICT[lang] && DICT[lang][key]) ?? DICT.en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

/** Apply translations to every [data-i18n], [data-i18n-ph], [data-i18n-aria] element. */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function money(n) {
  const v = Number(n || 0);
  return '৳' + v.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 2 });
}

export const num = (n) => Number(n || 0).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-US');

/** Pick the Bangla field when the language is Bangla and it is filled in. */
export const pick = (obj, field) => (lang === 'bn' && obj[`${field}_bn`]) ? obj[`${field}_bn`] : obj[field];

/** Same-origin, Cloudflare-cached image URL for a Supabase Storage object path. */
export const imgUrl = (path) => (path ? '/img/' + String(path).split('/').map(encodeURIComponent).join('/') : '');

export function slugify(s) {
  const base = String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base || 'item';
}

/** Words = whitespace-separated tokens that contain a letter or digit (markdown markers like "##" or "-" are not words). Works for Bangla. */
export const wordCount = (s) => (String(s || '').match(/\S+/gu) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Safe mini-markdown → HTML for product descriptions. Input is escaped first, then
 * paragraphs, line breaks, "## headings", "- bullet lists" and **bold** are applied.
 * Nothing the admin types can inject HTML or script.
 */
export function renderRichText(text) {
  const inline = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out = []; let para = []; let list = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list.length) { out.push('<ul>' + list.map((i) => `<li>${inline(i)}</li>`).join('') + '</ul>'); list = []; } };
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    const h = line.match(/^\s*#{1,3}\s+(.*)$/);
    const li = line.match(/^\s*[-•*]\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h4>${inline(h[1])}</h4>`); }
    else if (li) { flushPara(); list.push(li[1]); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  return out.join('');
}

export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 3200);
}

export function debounce(fn, ms = 200) {
  let h;
  return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}

export async function loadConfig() {
  const res = await fetch('/api/config', { cache: 'no-cache' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error('CONFIG_UNAVAILABLE');
  return data;
}

export const waLink = (number, text) => {
  let n = String(number || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '88' + n;
  return `https://wa.me/${n}` + (text ? `?text=${encodeURIComponent(text)}` : '');
};
