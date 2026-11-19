# Deployment guide — Nadia Gadget House

Stack: static site (`public/`) + Cloudflare Pages Functions (`functions/`) + Supabase (database, auth, storage) + Telegram Bot API.
There is **no build step**. Cloudflare serves `public/` and deploys `functions/` automatically.

---

## 0. The logo (do this first)

Your logo image was not delivered to the build environment, so the project does **not** contain it. Nothing was generated or substituted.

1. Save your logo as **`public/assets/logo.png`** (keep this exact name; PNG, ideally ≥ 256×256 with transparent background).
2. Commit and push it. It is then a permanent repository asset served from `/assets/logo.png` on every deployment.

Until the file exists, the site shows the store name as text (the built-in fallback). The logo is displayed in the navbar and the footer with `object-fit: contain`, so its proportions are preserved. To use a `.webp`/`.svg` instead, change `logo_url` in `store_settings` (e.g. `/assets/logo.webp`).

---

## 1. Supabase (one time)

1. Supabase Dashboard → **SQL Editor** → run, in order:
   1. `supabase/migrations/001_schema.sql`
   2. `supabase/migrations/002_rls_storage_realtime.sql`
   3. *(optional)* `supabase/seed_sample_data.sql` — demo products, all flagged `is_sample` and shown with a **Sample** badge. Delete them (`delete from public.products where is_sample;`) when you add real stock.
2. **Create your admin account:** Dashboard → Authentication → Users → *Add user* (email + password, tick *Auto Confirm*).
3. **Authorize it** (SQL Editor) — replace the email:
   ```sql
   insert into public.admin_users (user_id, email, role)
   select id, email, 'owner' from auth.users where email = 'you@example.com';
   ```
   Roles: `owner` can change Store Settings; `manager` can manage products, categories and orders.
4. In Authentication → Providers → Email, **disable "Allow new users to sign up"** so nobody can self-register. (Even if they could, they would not be in `admin_users`, and RLS would block every write.)
5. Copy from Project Settings → API: **Project URL**, **anon/publishable key**, **service_role/secret key**.

The migration also creates the public `product-images` bucket (5 MB limit, image types only, write access for admins only) and enables Realtime for `products`, `categories`, `store_settings`.

## 2. Telegram (one time)

1. The bot (id `7809248639`) must already exist from @BotFather — you need its **token**.
2. Open Telegram, send any message to the bot (a bot cannot message you first). For a group, add the bot to the group.
3. Get your **chat id**: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and read `message.chat.id` (negative for groups). **Do not paste the token anywhere except Cloudflare.**

## 3. GitHub → Cloudflare Pages

1. Push this folder to a GitHub repository.
2. Cloudflare Dashboard → Workers & Pages → **Create → Pages → Connect to Git** → pick the repo.
3. Build settings:
   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | *(leave empty)* |
   | Build output directory | `public` |
   | Root directory | *(empty)* |
4. Add the environment variables below (**Settings → Variables and Secrets**, for *Production* and, if you use previews, *Preview*).
5. Deploy. Every `git push` to the production branch redeploys automatically.

If you already have a connected Pages project, just push these files to its repository and set the variables — nothing else is needed.

## 4. Environment variables

| Variable | Where to set | Public / Secret | Used by | Redeploy needed after change? |
|---|---|---|---|---|
| `SUPABASE_URL` | Cloudflare Pages → Variables | Public (plain text) | Functions: `/api/config`, `/api/order`, `/img/*`; returned to browser via `/api/config` | Yes |
| `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`) | Cloudflare Pages → Variables | Public (designed to be public; protected by RLS) | Browser (via `/api/config`), admin-token check | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | Cloudflare Pages → **Secret** (Encrypt) | **SECRET** — server only | `/api/order`, `/api/retry-telegram` | Yes |
| `TELEGRAM_BOT_TOKEN` | Cloudflare Pages → **Secret** | **SECRET** — server only | `/api/order`, `/api/retry-telegram` | Yes |
| `TELEGRAM_CHAT_ID` | Cloudflare Pages → Variable (or Secret) | Private | `/api/order`, `/api/retry-telegram` | Yes |
| `IP_HASH_SALT` *(optional)* | Cloudflare Pages → Secret | Secret | Order rate-limiting (hashes IPs; raw IPs are never stored) | Yes |

Cloudflare only applies new variables to **new** deployments: after editing them, trigger a redeploy (Deployments → *Retry deployment*, or push a commit).

Secrets are never in the repository, in `localStorage`, or in any API response. `/api/health` reports only `true/false` per variable.

## 5. Verify the deployment

1. Open `https://<your-site>/api/health` → every check must be `true`.
2. Open the site → products load, logo shows.
3. Admin (see below) → add a product → refresh the storefront (or watch it appear live). **No redeploy is needed for product, price, stock, category or settings changes** — they live in Supabase.
4. Place a Cash-on-Delivery test order → you receive the Telegram message; the order appears in Admin → Orders with Telegram status `sent`.
5. If Telegram fails, the order is still saved with status `failed` and the reason; open it in Admin → Orders → **Retry Telegram**.

## 6. How to open the Admin Panel

1. Open the deployed website.
2. Scroll to the very bottom (footer).
3. Bottom-left of the footer, to the left of the © line, is an invisible 48×48 px tap area.
4. Tap/click it **7 times**, each tap within 1.5 s of the previous one (the counter resets after 1.5 s of inactivity).
5. The browser opens `/admin/` — only the **sign-in form** appears.
6. Sign in with the Supabase admin account from step 1.2/1.3. Accounts not listed in `admin_users` are signed out immediately.
7. **Back to store** (top-left) returns to the storefront.

Seven taps is only a hidden shortcut — **not security**. Real protection is Supabase Auth + the `admin_users` table + Row Level Security on every table and the storage bucket. You can also bookmark `/admin/` directly.

## 7. Content management cheat-sheet

| Task | Where |
|---|---|
| Add/edit/delete products, prices, stock, featured / new flags | Admin → Products |
| Long descriptions (1,000+ words; English and Bangla) | Product editor → *Full description* (large textarea, live word counter) |
| Images | Product editor → *Upload images* (auto-resized to a 1200 px image + 480 px thumbnail, WebP, with blur-up preview; first image is the cover) |
| Categories (+ image, visibility, order) | Admin → Categories (a category with products cannot be deleted) |
| Orders, status, Telegram retry | Admin → Orders |
| Store name, WhatsApp, delivery charges, bKash/Nagad numbers & instructions, hero banner | Admin → Settings (owner only) |

Description formatting: blank line = new paragraph, `## Heading`, `- list item`, `**bold**`. Nothing else is interpreted, and HTML typed into a description is shown as text, never executed.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Site shows "Could not load products" | `/api/health` → check `SUPABASE_URL`/`SUPABASE_ANON_KEY`; confirm both SQL migrations ran; redeploy after setting variables |
| Admin: "not authorized" | The user is missing in `admin_users` (step 1.3) |
| Order succeeds, Telegram `failed` | Open the order: the stored reason is Telegram's own error (wrong chat id, bot never started, bot blocked…). Fix, then **Retry Telegram** |
| Images don't appear | Bucket `product-images` must exist (migration 002); the image URL is `/img/<path>` (served via Cloudflare cache) |
| Admin page blank | The admin loads `@supabase/supabase-js` from `cdn.jsdelivr.net`; make sure the network/content-blocker allows it |
