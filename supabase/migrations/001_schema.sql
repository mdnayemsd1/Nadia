-- ============================================================================
-- Nadia Gadget House — 001: schema, functions, triggers
-- Run in: Supabase Dashboard -> SQL Editor (or `supabase db push`)
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Admin users (authorization). Authentication itself is Supabase Auth.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'manager' check (role in ('owner', 'manager')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  name_bn     text,
  slug        text not null unique,
  description text,
  image_path  text,
  is_visible  boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists categories_sort_idx on public.categories (sort_order, name);

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Products
--   description / description_bn are plain `text` (no length limit) so
--   1,000+ word descriptions (English or Bangla) are stored without truncation.
--   images: [{ "path": "...", "thumb": "...", "w": 1200, "h": 900, "lqip": "data:image/webp;base64,..." }]
--   specifications: [{ "label": "Battery", "label_bn": "ব্যাটারি", "value": "30h" }]
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 1 and 200),
  name_bn              text,
  slug                 text not null unique,
  short_description    text,
  short_description_bn text,
  description          text not null default '',
  description_bn       text,
  regular_price        numeric(12,2) not null check (regular_price >= 0),
  discount_price       numeric(12,2),
  discount_percent     integer generated always as (
    case
      when discount_price is not null and regular_price > 0 and discount_price < regular_price
        then round((1 - discount_price / regular_price) * 100)::integer
      else null
    end
  ) stored,
  category_id          uuid references public.categories(id) on delete restrict,
  images               jsonb not null default '[]'::jsonb,
  specifications       jsonb not null default '[]'::jsonb,
  stock_quantity       integer not null default 0 check (stock_quantity >= 0),
  is_available         boolean not null default true,
  is_featured          boolean not null default false,
  is_new_arrival       boolean not null default false,
  is_sample            boolean not null default false,
  sold_count           integer not null default 0 check (sold_count >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint products_discount_valid
    check (discount_price is null or (discount_price >= 0 and discount_price < regular_price))
);
create index if not exists products_category_idx   on public.products (category_id);
create index if not exists products_created_idx    on public.products (created_at desc);
create index if not exists products_featured_idx   on public.products (is_featured) where is_featured;
create index if not exists products_new_idx        on public.products (is_new_arrival) where is_new_arrival;
create index if not exists products_sold_idx       on public.products (sold_count desc);

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Store settings (single row, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists public.store_settings (
  id                      integer primary key default 1 check (id = 1),
  store_name              text not null default 'Nadia Gadget House',
  store_name_bn           text not null default 'নাদিয়া গ্যাজেট হাউস',
  tagline                 text not null default 'Premium gadgets, honest prices',
  tagline_bn              text not null default 'প্রিমিয়াম গ্যাজেট, সৎ দাম',
  whatsapp_number         text not null default '01852316348',
  contact_phone           text not null default '01852316348',
  contact_email           text,
  facebook_url            text,
  address                 text,
  address_bn              text,
  delivery_inside_dhaka   numeric(10,2) not null default 70  check (delivery_inside_dhaka  >= 0),
  delivery_outside_dhaka  numeric(10,2) not null default 130 check (delivery_outside_dhaka >= 0),
  bkash_number            text,
  nagad_number            text,
  payment_instructions    jsonb not null default jsonb_build_object(
    'bkash', jsonb_build_object(
      'en', 'Send the total amount via bKash (Send Money) to the number shown, then enter the transaction ID below. Your order is confirmed after we manually verify the payment.',
      'bn', 'নিচের নম্বরে বিকাশে (সেন্ড মানি) মোট টাকা পাঠিয়ে ট্রানজেকশন আইডি দিন। আমরা ম্যানুয়ালি পেমেন্ট যাচাই করার পর অর্ডার নিশ্চিত হবে।'),
    'nagad', jsonb_build_object(
      'en', 'Send the total amount via Nagad (Send Money) to the number shown, then enter the transaction ID below. Your order is confirmed after we manually verify the payment.',
      'bn', 'নিচের নম্বরে নগদে (সেন্ড মানি) মোট টাকা পাঠিয়ে ট্রানজেকশন আইডি দিন। আমরা ম্যানুয়ালি পেমেন্ট যাচাই করার পর অর্ডার নিশ্চিত হবে।'),
    'cod', jsonb_build_object(
      'en', 'Pay in cash when the product is delivered to you.',
      'bn', 'পণ্য হাতে পাওয়ার সময় নগদ টাকা দিন।')
  ),
  homepage_banner         jsonb not null default jsonb_build_object(
    'badge',       'New season drop · Up to 30% off',
    'badge_bn',    'নতুন কালেকশন · ৩০% পর্যন্ত ছাড়',
    'title',       'Smart gadgets, delivered across Bangladesh',
    'title_bn',    'স্মার্ট গ্যাজেট, সারা বাংলাদেশে ডেলিভারি',
    'subtitle',    'Premium audio, wearables and home appliances at honest prices. Pay with bKash, Nagad or Cash on Delivery.',
    'subtitle_bn', 'প্রিমিয়াম অডিও, ওয়্যারেবল ও হোম অ্যাপ্লায়েন্স সৎ দামে। বিকাশ, নগদ বা ক্যাশ অন ডেলিভারিতে পেমেন্ট করুন।',
    'image_path',  null
  ),
  logo_url                text not null default '/assets/logo.png',
  updated_at              timestamptz not null default now()
);

insert into public.store_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists store_settings_touch on public.store_settings;
create trigger store_settings_touch before update on public.store_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create sequence if not exists public.order_number_seq start 1001;

create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  order_number          text not null unique,
  idempotency_key       text unique,
  customer_name         text not null,
  phone                 text not null,
  address               text not null,
  district              text not null,
  notes                 text,
  payment_method        text not null check (payment_method in ('bkash', 'nagad', 'cod')),
  transaction_reference text,
  subtotal              numeric(12,2) not null check (subtotal >= 0),
  delivery_charge       numeric(12,2) not null check (delivery_charge >= 0),
  total                 numeric(12,2) not null check (total >= 0),
  status                text not null default 'pending'
                        check (status in ('pending','confirmed','processing','shipped','delivered','cancelled')),
  telegram_status       text not null default 'pending' check (telegram_status in ('pending','sent','failed')),
  telegram_error        text,
  telegram_sent_at      timestamptz,
  ip_hash               text,
  language              text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists orders_created_idx  on public.orders (created_at desc);
create index if not exists orders_status_idx   on public.orders (status);
create index if not exists orders_phone_idx    on public.orders (phone, created_at desc);
create index if not exists orders_iphash_idx   on public.orders (ip_hash, created_at desc);
create index if not exists orders_tg_idx       on public.orders (telegram_status) where telegram_status <> 'sent';

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity    integer not null check (quantity > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0)
);
create index if not exists order_items_order_idx   on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

-- Cancelling an order returns its stock. A cancelled order cannot be re-opened.
create or replace function public.orders_status_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'CANCELLED_ORDER_LOCKED';
  end if;
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    update public.products p
       set stock_quantity = p.stock_quantity + oi.quantity,
           sold_count     = greatest(p.sold_count - oi.quantity, 0)
      from public.order_items oi
     where oi.order_id = new.id and oi.product_id = p.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_guard_trg on public.orders;
create trigger orders_status_guard_trg before update of status on public.orders
  for each row execute function public.orders_status_guard();

-- ---------------------------------------------------------------------------
-- create_order(): the ONLY way an order is created.
--   * Called by the Cloudflare Function with the service-role key.
--   * Prices, stock and totals are read from the database — never from the browser.
--   * Atomic: row locks on products, stock decrement, order + items insert.
--   * Idempotent on p_key (duplicate submissions return the original order).
--   * Rate limited: max 3 orders / 10 min per phone and per IP hash.
-- p_items: [{ "id": "<uuid>", "qty": 2 }]  (the function layer merges duplicates & sorts by id)
-- ---------------------------------------------------------------------------
create or replace function public.create_order(
  p_customer jsonb,
  p_items    jsonb,
  p_key      text,
  p_ip_hash  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing   public.orders%rowtype;
  v_settings   public.store_settings%rowtype;
  v_item       jsonb;
  v_prod       public.products%rowtype;
  v_qty        integer;
  v_price      numeric(12,2);
  v_subtotal   numeric(12,2) := 0;
  v_delivery   numeric(12,2);
  v_total      numeric(12,2);
  v_order_id   uuid := gen_random_uuid();
  v_number     text;
  v_recent     integer;
  v_phone      text := p_customer->>'phone';
  v_district   text := p_customer->>'district';
begin
  if p_key is null or char_length(p_key) < 8 then
    raise exception 'INVALID_KEY';
  end if;

  select * into v_existing from public.orders where idempotency_key = p_key;
  if found then
    return jsonb_build_object('duplicate', true, 'order_id', v_existing.id,
                              'order_number', v_existing.order_number);
  end if;

  select count(*) into v_recent from public.orders
   where created_at > now() - interval '10 minutes'
     and (phone = v_phone or (p_ip_hash is not null and ip_hash = p_ip_hash));
  if v_recent >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_ITEMS';
  end if;

  select * into v_settings from public.store_settings where id = 1;
  v_number := 'NGH-' || to_char(now() at time zone 'Asia/Dhaka', 'YYMMDD') || '-' ||
              lpad(nextval('public.order_number_seq')::text, 4, '0');

  insert into public.orders (
    id, order_number, idempotency_key, customer_name, phone, address, district, notes,
    payment_method, transaction_reference, subtotal, delivery_charge, total, ip_hash, language
  ) values (
    v_order_id, v_number, p_key, p_customer->>'name', v_phone, p_customer->>'address', v_district,
    nullif(p_customer->>'notes', ''), p_customer->>'payment_method',
    nullif(p_customer->>'transaction_reference', ''), 0, 0, 0, p_ip_hash, p_customer->>'language'
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'INVALID_QTY';
    end if;

    select * into v_prod from public.products where id = (v_item->>'id')::uuid for update;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND|%', v_item->>'id';
    end if;
    if not v_prod.is_available or v_prod.stock_quantity < v_qty then
      raise exception 'OUT_OF_STOCK|%|%|%', v_prod.id, v_prod.name, v_prod.stock_quantity;
    end if;

    v_price := coalesce(v_prod.discount_price, v_prod.regular_price);
    v_subtotal := v_subtotal + v_price * v_qty;

    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
    values (v_order_id, v_prod.id, v_prod.name, v_qty, v_price, v_price * v_qty);

    update public.products
       set stock_quantity = stock_quantity - v_qty,
           sold_count     = sold_count + v_qty
     where id = v_prod.id;
  end loop;

  v_delivery := case when lower(v_district) = 'dhaka' then v_settings.delivery_inside_dhaka
                     else v_settings.delivery_outside_dhaka end;
  v_total := v_subtotal + v_delivery;

  update public.orders
     set subtotal = v_subtotal, delivery_charge = v_delivery, total = v_total
   where id = v_order_id;

  return jsonb_build_object('duplicate', false, 'order_id', v_order_id, 'order_number', v_number,
                            'subtotal', v_subtotal, 'delivery_charge', v_delivery, 'total', v_total);
end;
$$;

revoke all on function public.create_order(jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_order(jsonb, jsonb, text, text) to service_role;
