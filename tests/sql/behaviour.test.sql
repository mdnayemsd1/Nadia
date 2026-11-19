-- Behavioural tests for the database layer. Run on a scratch DB after the stub + migrations + seed.
-- Every check raises an exception on failure (psql runs with ON_ERROR_STOP).
\set ON_ERROR_STOP on
create schema if not exists t; grant usage on schema t to public;

create or replace function t.expect_error(stmt text, role_name text, must_contain text) returns void language plpgsql as $$
declare msg text;
begin
  begin
    execute format('set local role %I', role_name);
    execute stmt;
    execute 'reset role';
    raise exception 'EXPECTED ERROR (%) BUT STATEMENT SUCCEEDED: %', must_contain, stmt;
  exception when others then
    execute 'reset role';
    get stacked diagnostics msg = message_text;
    if msg like 'EXPECTED ERROR%' then raise; end if;
    if position(lower(must_contain) in lower(msg)) = 0 then raise exception 'wrong error. wanted "%" got "%"', must_contain, msg; end if;
  end;
end $$;

create or replace function t.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ASSERT FAILED: %', label; end if; raise notice 'PASS  %', label; end $$;

-- ---------------------------------------------------------------- fixtures
do $$
declare staff uuid := gen_random_uuid(); owner_id uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values (staff,'manager@x'),(owner_id,'owner@x'),(stranger,'stranger@x');
  insert into public.admin_users(user_id,email,role) values (staff,'manager@x','manager'),(owner_id,'owner@x','owner');
  perform set_config('t.staff', staff::text, false); perform set_config('t.owner', owner_id::text, false); perform set_config('t.stranger', stranger::text, false);
end $$;

select t.assert((select count(*) from public.products) = 8 and (select count(*) from public.categories) = 5, 'seed loaded (8 products, 5 categories)');
select t.assert((select bool_and(is_sample) from public.products), 'all seeded products flagged is_sample');
select t.assert((select discount_percent from public.products where slug='sample-pulse-anc-earbuds') = 22, 'discount_percent generated (3200→2490 = 22%)');

-- ---------------------------------------------------------------- long descriptions
do $$
declare en text; bn text; got record;
begin
  select string_agg('word' || g, ' ') into en from generate_series(1,1500) g;
  select string_agg('শব্দ' || g, ' ') into bn from generate_series(1,1500) g;
  en := en || E'\n\n## Heading\n- item\n\n**bold**';
  update public.products set description = en, description_bn = bn where slug = 'sample-boom-mini-speaker';
  select length(description) l1, length(description_bn) l2, description d1, description_bn d2 into got from public.products where slug='sample-boom-mini-speaker';
  perform t.assert(got.d1 = en and got.d2 = bn, '1,500-word English + Bangla descriptions stored with zero truncation (' || got.l1 || ' / ' || got.l2 || ' chars)');
end $$;

-- ---------------------------------------------------------------- constraints
select t.expect_error($$update public.products set discount_price = regular_price where slug='sample-boom-mini-speaker'$$, 'postgres', 'products_discount_valid');
select t.expect_error($$update public.products set stock_quantity = -1 where slug='sample-boom-mini-speaker'$$, 'postgres', 'stock_quantity');
select t.expect_error($$delete from public.categories where slug='kitchen'$$, 'postgres', 'violates foreign key');

-- ---------------------------------------------------------------- create_order
do $$
declare
  pid uuid := (select id from public.products where slug='sample-pulse-anc-earbuds');
  r jsonb; r2 jsonb; stock0 int; stock1 int;
  cust jsonb := jsonb_build_object('name','Rahim','phone','01712345678','address','House 5, Road 3, Dhanmondi','district','Dhaka','notes','','payment_method','cod','transaction_reference','','language','en');
begin
  select stock_quantity into stock0 from public.products where id = pid;
  r := public.create_order(cust, jsonb_build_array(jsonb_build_object('id',pid,'qty',2)), 'key-aaaaaaaa-1', 'iphash1');
  select stock_quantity into stock1 from public.products where id = pid;
  perform t.assert((r->>'subtotal')::numeric = 4980 and (r->>'delivery_charge')::numeric = 70 and (r->>'total')::numeric = 5050, 'order total computed from DB prices: 2×2490 + 70 Dhaka = 5050');
  perform t.assert(stock1 = stock0 - 2, 'stock decremented by ordered quantity');
  perform t.assert((r->>'order_number') like 'NGH-%', 'order number format ' || (r->>'order_number'));
  perform t.assert((select telegram_status from public.orders where id=(r->>'order_id')::uuid) = 'pending', 'new order starts with telegram_status=pending');
  perform t.assert((select unit_price from public.order_items where order_id=(r->>'order_id')::uuid) = 2490, 'order item snapshot uses discount price');

  r2 := public.create_order(cust, jsonb_build_array(jsonb_build_object('id',pid,'qty',2)), 'key-aaaaaaaa-1', 'iphash1');
  perform t.assert((r2->>'duplicate')::boolean and r2->>'order_id' = r->>'order_id', 'same idempotency key returns the original order');
  perform t.assert((select stock_quantity from public.products where id = pid) = stock1, 'duplicate submission did not decrement stock again');

  r := public.create_order(cust || '{"district":"Sylhet","phone":"01899999999"}', jsonb_build_array(jsonb_build_object('id',pid,'qty',1)), 'key-bbbbbbbb-2', 'iphash2');
  perform t.assert((r->>'delivery_charge')::numeric = 130, 'outside-Dhaka delivery charge = 130');
end $$;

select t.expect_error($$select public.create_order('{"name":"A","phone":"01600000001","address":"x y z 1234567","district":"Dhaka","payment_method":"cod"}'::jsonb, jsonb_build_array(jsonb_build_object('id',(select id from public.products where slug='sample-zen-electric-kettle'),'qty',1)), 'key-cccccccc-3', null)$$, 'postgres', 'OUT_OF_STOCK');
select t.expect_error($$select public.create_order('{"name":"A","phone":"01600000002","address":"x y z 1234567","district":"Dhaka","payment_method":"cod"}'::jsonb, jsonb_build_array(jsonb_build_object('id',(select id from public.products where slug='sample-chef-blend-blender'),'qty',99)), 'key-dddddddd-4', null)$$, 'postgres', 'INVALID_QTY');
select t.expect_error($$select public.create_order('{"name":"A","phone":"01600000003","address":"x y z 1234567","district":"Dhaka","payment_method":"cod"}'::jsonb, jsonb_build_array(jsonb_build_object('id',(select id from public.products where slug='sample-chef-blend-blender'),'qty',20)), 'key-eeeeeeee-5', null)$$, 'postgres', 'OUT_OF_STOCK'); -- 20 requested, 8 in stock
select t.assert((select count(*) from public.orders where phone in ('01600000001','01600000002','01600000003')) = 0, 'failed orders are rolled back completely (no orphan order rows)');
select t.assert((select stock_quantity from public.products where slug='sample-chef-blend-blender') = 8, 'rolled-back order left stock untouched');
select t.expect_error($$select public.create_order('{"name":"A","phone":"01600000004","address":"x y z 1234567","district":"Dhaka","payment_method":"cod"}'::jsonb, jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-000000000000','qty',1)), 'key-ffffffff-6', null)$$, 'postgres', 'PRODUCT_NOT_FOUND');

-- rate limit: phone 01712345678 already has 1 order; add 2 more, 4th must be blocked
do $$
declare pid uuid := (select id from public.products where slug='sample-wave-neckband'); i int;
begin
  for i in 1..2 loop
    perform public.create_order('{"name":"Rahim","phone":"01712345678","address":"House 5, Road 3, Dhanmondi","district":"Dhaka","payment_method":"cod"}'::jsonb, jsonb_build_array(jsonb_build_object('id',pid,'qty',1)), 'key-rate-' || i || '-xxxx', null);
  end loop;
end $$;
select t.expect_error($$select public.create_order('{"name":"Rahim","phone":"01712345678","address":"House 5, Road 3, Dhanmondi","district":"Dhaka","payment_method":"cod"}'::jsonb, jsonb_build_array(jsonb_build_object('id',(select id from public.products where slug='sample-wave-neckband'),'qty',1)), 'key-rate-4-xxxx', null)$$, 'postgres', 'RATE_LIMITED');

-- ---------------------------------------------------------------- cancel returns stock; cancelled is final
do $$
declare oid uuid; pid uuid := (select id from public.products where slug='sample-fit-band-8'); s0 int; r jsonb;
begin
  select stock_quantity into s0 from public.products where id = pid;
  r := public.create_order('{"name":"Karim","phone":"01811111111","address":"Village X, Post Y, Upazila Z","district":"Khulna","payment_method":"cod"}'::jsonb, jsonb_build_array(jsonb_build_object('id',pid,'qty',3)), 'key-cancel-xxxx', null);
  oid := (r->>'order_id')::uuid;
  perform t.assert((select stock_quantity from public.products where id=pid) = s0 - 3, 'stock reserved by order');
  update public.orders set status='cancelled' where id=oid;
  perform t.assert((select stock_quantity from public.products where id=pid) = s0, 'cancelling an order returns stock');
  perform set_config('t.cancelled', oid::text, false);
end $$;
select t.expect_error($$update public.orders set status='pending' where id = current_setting('t.cancelled')::uuid$$, 'postgres', 'CANCELLED_ORDER_LOCKED');

-- ---------------------------------------------------------------- RLS / privileges
select t.assert((select count(*) from (select 1) s) = 1, 'harness ok');
set role anon;
select t.assert((select count(*) from public.products) = 8, 'anon can read products');
select t.assert((select count(*) from public.categories) = 5, 'anon can read visible categories');
select t.assert((select count(*) from public.store_settings) = 1, 'anon can read store settings');
reset role;
select t.expect_error($$select * from public.orders$$, 'anon', 'permission denied');
select t.expect_error($$select * from public.order_items$$, 'anon', 'permission denied');
select t.expect_error($$select * from public.admin_users$$, 'anon', 'permission denied');
select t.expect_error($$insert into public.orders(order_number,customer_name,phone,address,district,payment_method,subtotal,delivery_charge,total) values ('X','x','x','x','x','cod',1,1,1)$$, 'anon', 'permission denied');
select t.expect_error($$update public.products set regular_price = 1$$, 'anon', 'permission denied');
select t.expect_error($$select public.create_order('{}'::jsonb,'[]'::jsonb,'key-anonanon-1',null)$$, 'anon', 'permission denied');
select t.expect_error($$select public.create_order('{}'::jsonb,'[]'::jsonb,'key-authauth-1',null)$$, 'authenticated', 'permission denied');

-- signed-in but NOT an admin
select set_config('request.jwt.claim.sub', current_setting('t.stranger'), false);
select t.assert((select count(*) from public.products) = 8, 'sanity (superuser)');
set role authenticated;
select t.assert((select count(*) from public.orders) = 0, 'non-admin user sees 0 orders (RLS)');
reset role;
select t.expect_error($$insert into public.products(name,slug,regular_price) values ('hack','hack',1)$$, 'authenticated', 'row-level security');
set role authenticated; update public.store_settings set store_name='hacked'; reset role;  -- 0 rows: RLS filters silently
select t.assert((select store_name from public.store_settings) = 'Nadia Gadget House', 'non-admin could not change store settings');
select t.assert((select count(*) from public.products where name='hack') = 0, 'no product was inserted by a non-admin');

-- manager
select set_config('request.jwt.claim.sub', current_setting('t.staff'), false);
set role authenticated;
select t.assert((select count(*) from public.orders) > 0, 'manager can read orders');
insert into public.products(name,slug,regular_price,stock_quantity) values ('Manager product','manager-product',100,5);
update public.orders set status='confirmed' where id = (select id from public.orders order by created_at limit 1);
update public.store_settings set store_name = 'Manager Edit';
reset role;
select t.assert((select count(*) from public.products where slug='manager-product') = 1, 'manager can create products');
select t.assert((select store_name from public.store_settings) = 'Nadia Gadget House', 'manager CANNOT change store settings (owner only)');

-- owner
select set_config('request.jwt.claim.sub', current_setting('t.owner'), false);
set role authenticated;
update public.store_settings set store_name = 'Owner Edit';
reset role;
select t.assert((select store_name from public.store_settings) = 'Owner Edit', 'owner can change store settings');
update public.store_settings set store_name = 'Nadia Gadget House';

-- storage policies (policy presence + bucket limits)
select t.assert((select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'product_images_%') = 4, '4 storage policies on product-images bucket');
select t.assert((select file_size_limit from storage.buckets where id='product-images') = 5242880 and (select public from storage.buckets where id='product-images'), 'bucket: public read, 5 MB limit');
select t.assert((select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename in ('products','categories','store_settings')) = 3, 'realtime publication includes products, categories, store_settings');

-- migrations are re-runnable
\i supabase/migrations/001_schema.sql
\i supabase/migrations/002_rls_storage_realtime.sql
select t.assert((select count(*) from public.products) >= 8, 're-running both migrations is safe (data kept)');
