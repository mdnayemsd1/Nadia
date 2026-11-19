-- ============================================================================
-- Nadia Gadget House — 002: Row Level Security, Storage, Realtime
-- Run AFTER 001_schema.sql.
-- ============================================================================

alter table public.admin_users    enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.store_settings enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;

-- Clean re-run
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('admin_users','categories','products','store_settings','orders','order_items')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- admin_users: a signed-in user may read only their own row (lets the panel check authorization).
-- No insert/update/delete policies: add admins from the SQL editor (see docs/DEPLOYMENT.md).
create policy admin_self_read on public.admin_users
  for select to authenticated using (user_id = auth.uid());

-- categories: public sees visible ones; staff see and manage all.
create policy categories_public_read on public.categories
  for select to anon, authenticated using (is_visible or public.is_staff());
create policy categories_staff_write on public.categories
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- products: public catalogue (availability is shown on the storefront); staff manage.
create policy products_public_read on public.products
  for select to anon, authenticated using (true);
create policy products_staff_write on public.products
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- store_settings: public read (store name, delivery fees, payment numbers are shown at checkout);
-- only the owner may change them.
create policy settings_public_read on public.store_settings
  for select to anon, authenticated using (true);
create policy settings_owner_update on public.store_settings
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- orders: NO public access at all. Orders are created by the server (service role) through
-- create_order(). Staff can read and update (status) them.
create policy orders_staff_read on public.orders
  for select to authenticated using (public.is_staff());
create policy orders_staff_update on public.orders
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy order_items_staff_read on public.order_items
  for select to authenticated using (public.is_staff());

-- Table privileges (RLS still applies on top of these)
revoke all on public.orders, public.order_items, public.admin_users from anon;
grant select on public.categories, public.products, public.store_settings to anon;
grant select, insert, update, delete on public.categories, public.products to authenticated;
grant select, update on public.store_settings to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.admin_users to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: public-read bucket for product / category / banner images.
-- Writes are restricted to staff; 5 MB limit; image MIME types only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/avif'];

drop policy if exists "product_images_public_read"  on storage.objects;
drop policy if exists "product_images_staff_insert" on storage.objects;
drop policy if exists "product_images_staff_update" on storage.objects;
drop policy if exists "product_images_staff_delete" on storage.objects;

create policy "product_images_public_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');
create policy "product_images_staff_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_staff());
create policy "product_images_staff_update" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_staff())
  with check (bucket_id = 'product-images' and public.is_staff());
create policy "product_images_staff_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_staff());

-- ---------------------------------------------------------------------------
-- Realtime: storefront refreshes automatically when catalogue data changes.
-- ---------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.products;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.categories;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.store_settings; exception when duplicate_object then null; end;
end $$;
