# Testing report (honest)

Run date: 2026-11-19. Everything below was **actually executed** in the build environment. Nothing here was run against your real Supabase project, Cloudflare account or Telegram bot — those credentials were not available — so the **live-integration checklist at the bottom is still yours to run once after deploying**.

## What was executed

| Suite | Command | Result | What it proves |
|---|---|---|---|
| Server logic (Node) | `npm test` | **19 / 19 pass** | Phone/field validation, server ignores browser prices, order flow, Telegram message content + HTML escaping, Telegram success only on `ok:true`, token never in responses/errors, failure handling (order kept, status `failed`), duplicate handling, rate-limit / stock / validation error mapping, honeypot, cross-origin, content-type, payload size, `/api/config` and `/api/health` expose no secrets, `/api/retry-telegram` auth (401 / 403 / success). Supabase and Telegram are **mocked**. |
| Database (real PostgreSQL 16) | `npm run test:sql` | **32 assertions + 17 denied-operation checks pass** | Both migrations apply cleanly and are re-runnable. 1,500-word English and Bangla descriptions stored with zero truncation. `create_order()` totals from DB prices, stock decrement, idempotency, rollback on failure (no orphan rows), rate limit, cancel returns stock, cancelled is final. RLS: anonymous users cannot read/write orders, admin list, or call `create_order`; non-admin signed-in users get nothing; manager can manage products/orders but **not** settings; owner can. FK blocks deleting a category in use. Storage policies and bucket limits exist. **Supabase's own `auth`/`storage` were stubbed** (roles, `auth.uid()`, tables), so real Supabase may differ in details. |
| Storefront in Chromium | `node tests/e2e/storefront.e2e.mjs` | **21 / 21 pass** | Against a mock backend: products render; Sample labels; no horizontal overflow at 320/360/375/430/768/1280 px; eager/lazy images, thumbnails, width/height; search (name, Bangla, category, multi-word); category filter; all four sorts; out-of-stock state; product details with safe rendering of long descriptions (markdown, script text is escaped and does not run); cart add/limits/remove/persistence/deleted-product cleanup; EN↔বাংলা + persistence + font; mobile menu; WhatsApp links; back-to-top; logo fallback; **seven-tap** (6 taps, slow taps → no navigation; 7 quick taps → `/admin/`); checkout validation, payload contains no prices, delivery shown by district, bKash/Nagad manual-verification text, Telegram-sent vs Telegram-failed messages, same idempotency key after a network failure, double-click sends one request. |
| Admin in Chromium | `node tests/e2e/admin.e2e.mjs` | **14 / 14 pass** | Against an **in-memory fake of supabase-js**: login required, wrong password, signed-in-but-not-admin rejected, dashboard counts, **1,200-word EN + BN description saved byte-identical and reloaded in the editor with a live word counter**, validation, edit/delete (storage cleanup), image upload (canvas → WebP full + thumb + blur-up, unique names, 1-year cache header, cover, orphan cleanup on cancel, type validation), category CRUD with delete-blocked-when-in-use, orders (filter, details, payment reference, status change, Telegram retry with bearer token), settings (owner saves, manager read-only), Bangla admin UI and no overflow at 360 px. |
| Syntax | `node --check` on every JS file | pass | |

Total: 19 + 49 (SQL) + 21 + 14 = **103 checks**, 0 failing at the end of the run. Defects found and fixed along the way: hidden-attribute overridden by CSS (cart badge showed "0", back-to-top always visible), heading-followed-by-list not rendering in descriptions, hidden admin tap area covered by the WhatsApp button, word counter counting markdown symbols, product-card button text wrapping on phones, extra form spacing, close-button layout in dialogs.

## NOT tested / not possible here

* **Real Supabase** (Auth sign-in, Storage upload + policies against the live bucket, Realtime push), **real Cloudflare Pages** build/deploy, `/img` edge caching, and **real Telegram delivery**. The code is written against their documented APIs but has not touched them.
* **Your logo** — the file never arrived, so it is not in the project (see DEPLOYMENT.md §0). The fallback (store name text) was tested.
* **Performance numbers** (LCP/CLS/INP) were not measured; the image strategy follows best practice but no Lighthouse run was possible.
* **Real devices / browsers:** only desktop Chromium emulating phone widths. Safari/iOS, Firefox and physical Android phones were not tested.
* Browsers without WebP *encoding* fall back to JPEG for uploads (code path present, not exercised).
* Cloudflare's `_headers` CSP was not exercised in a browser (tests used a plain static server). If a CDN/font is blocked by it, the browser console will show a `Content-Security-Policy` message.

## Live-integration checklist (run once after deployment, ~10 minutes)

1. `/api/health` → all `true`.
2. Homepage loads; product images load from `/img/…`; logo visible.
3. Admin (7 taps, bottom-left of footer) → sign in → add a product with an image and a long description → it appears on the storefront without redeploying.
4. Place a Cash-on-Delivery order → Telegram message arrives; Admin → Orders shows Telegram `sent`.
5. Temporarily set a wrong `TELEGRAM_CHAT_ID` → place an order → success page shows the "saved, team will see it" notice (not "notified"), order shows `failed`; fix the id, redeploy, press **Retry Telegram**.
6. Sign in with a Supabase user that is *not* in `admin_users` → rejected.
7. Open the site on a real Android phone and an iPhone.
