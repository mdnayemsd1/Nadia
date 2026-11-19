# Nadia Gadget House

Bilingual (English / বাংলা) e-commerce site for Bangladesh — storefront, hidden-entry admin panel, secure order API with Telegram notifications.

**Stack:** static HTML/CSS/ES-modules (`public/`) · Cloudflare Pages Functions (`functions/`) · Supabase (Postgres, Auth, Storage, Realtime) · Telegram Bot API. No build step, no framework.

```
public/                     ← Cloudflare Pages output directory
  index.html                storefront
  admin/index.html          admin panel (Supabase login required)
  assets/logo.png           ← PUT YOUR LOGO HERE (see docs/DEPLOYMENT.md §0)
  assets/css, assets/js     styles and ES modules (i18n, common helpers, store, admin)
  _headers                  security headers + CSP + caching
functions/
  api/order.js              POST  create order → Telegram notify
  api/retry-telegram.js     POST  admin-only Telegram retry
  api/config.js             GET   public Supabase URL + anon key (runtime, no rebuild)
  api/health.js             GET   which env vars are set (booleans only)
  img/[[path]].js           GET   edge-cached image proxy for Supabase Storage
  _lib/                     validation, Supabase REST client, Telegram formatter
supabase/
  migrations/001_schema.sql         tables, indexes, triggers, create_order() RPC
  migrations/002_rls_storage_realtime.sql   RLS, storage bucket + policies, realtime
  seed_sample_data.sql              OPTIONAL demo data (flagged "Sample")
tests/                      unit, SQL and browser tests (see docs/TESTING.md)
docs/DEPLOYMENT.md          step-by-step setup, env-variable table, admin access
```

## How it fits together

* **Catalogue:** the browser reads `products`, `categories`, `store_settings` straight from Supabase (public anon key, read-only through RLS). Editing data in the admin panel (or Supabase) updates the live site — via Realtime, refetch-on-focus and a 90 s refresh — **without a redeploy**.
* **Orders:** the browser sends only product IDs and quantities to `/api/order`. The server validates everything, then the Postgres function `create_order()` — callable only with the service-role key — locks the product rows, checks stock, **reads the prices from the database**, computes the total and delivery charge, decrements stock and writes the order in one transaction. Only then is Telegram called, and the real outcome (`sent`/`failed`) is stored on the order. A failed Telegram call never loses the order and is never reported as sent; admins can retry from Orders.
* **Duplicate protection:** per-checkout idempotency key (stable across network retries), disabled submit button, server-side rate limit (3 orders / 10 min per phone and per hashed IP), honeypot field, same-origin check.
* **Admin security:** seven taps only navigates to `/admin/`. Access is Supabase Auth + an `admin_users` row + RLS on every table and on the storage bucket. Roles: `owner` (settings) and `manager`.
* **Images:** uploads are resized in the browser to WebP — a 1200 px version for the detail view and a 480 px thumbnail for cards — plus a 24 px blur-up preview. Cards use `srcset`, explicit width/height, lazy loading (first 4 images eager + `fetchpriority=high`), and are served from `/img/…` with a one-year immutable cache at Cloudflare's edge.
* **Bangla:** Noto Sans Bengali / Noto Sans stack, all UI strings and districts translated, products have optional Bangla name/description fields; language choice persists.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in real values (git-ignored)
npm install
npm run dev                      # wrangler pages dev public
npm test                         # unit tests (Node ≥ 20, no dependencies)
npm run test:e2e                 # browser tests (needs Playwright + Chromium)
npm run test:sql                 # database tests (needs a local PostgreSQL server)
```

## Known limits (by design)

* bKash / Nagad are **manual** payments: the customer enters a transaction ID and staff verify it; the site never claims automatic verification. A real gateway would need a merchant integration.
* Supabase image *transformations* are a paid feature, so resizing happens at upload time instead.
* The admin panel and the Realtime client load `@supabase/supabase-js` (pinned version) from jsDelivr.
