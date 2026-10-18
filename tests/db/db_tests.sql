-- Stoph Shop — database tests. Run in the Supabase SQL Editor AFTER 01-03.
-- Everything runs inside a transaction that is ROLLED BACK: nothing is kept.
-- Each DO block raises an exception on failure; a final NOTICE confirms success.
-- (Run the whole file at once. If you see no error, all assertions passed.)
begin;

create temp table _base as select count(*)::int as n from public.orders;

-- fixtures
insert into public.categories (id, slug, name_ar, name_fr) values ('00000000-0000-0000-0000-0000000000c1','t-cat','ت','T');
insert into public.products (id, category_id, slug, name_ar, name_fr, price, sale_price, is_published, is_available) values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','t-simple','بسيط','Simple',100,80,true,true),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1','t-var','متغير','Var',50,null,true,true),
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c1','t-hidden','مخفي','Hidden',10,null,false,true),
 ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000c1','t-off','غير متوفر','Off',10,null,true,false);
insert into public.product_variants (id, product_id, label_ar, label_fr, is_available) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a2','أ','A',true),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','ب','B',false);
insert into public.shipping_rates (city, fee) values ('TestVille', 15);

create or replace function pg_temp.expect_error(p_code text, p_items jsonb, p_phone text default '0612345678')
returns void language plpgsql as $$
begin
  perform public.create_order(jsonb_build_object('full_name','Test User','phone',p_phone,'city','Fes','address','12 rue test'), p_items);
  raise exception 'FAIL: expected % but order was created', p_code;
exception when others then
  if sqlerrm <> p_code then raise exception 'FAIL: expected %, got %', p_code, sqlerrm; end if;
end $$;

do $$
declare r jsonb; o record;
begin
  -- 1. totals computed on the server (price 100, sale 80, qty 2 => 160 + default fee)
  r := public.create_order(
    '{"full_name":"Test User","phone":"+212612345678","city":"Fes","address":"12 rue test"}'::jsonb,
    '[{"product_id":"00000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb);
  if (r->>'subtotal')::numeric <> 160 then raise exception 'FAIL subtotal %', r; end if;
  if (r->>'discount_total')::numeric <> 40 then raise exception 'FAIL discount %', r; end if;
  if (r->>'total')::numeric <> 160 + (r->>'shipping_fee')::numeric then raise exception 'FAIL total %', r; end if;
  select * into o from public.orders where order_number = (r->>'order_number')::bigint;
  if o.status <> 'pending_confirmation' then raise exception 'FAIL initial status'; end if;
  if o.phone <> '0612345678' then raise exception 'FAIL phone normalisation: %', o.phone; end if;

  -- 2. city-specific shipping fee
  r := public.create_order(
    '{"full_name":"Test User","phone":"0612345678","city":"testville","address":"12 rue test"}'::jsonb,
    '[{"product_id":"00000000-0000-0000-0000-0000000000a1","quantity":1}]'::jsonb);
  if (r->>'shipping_fee')::numeric <> 15 then raise exception 'FAIL city fee %', r; end if;

  -- 3. snapshot is stored on order_items
  if not exists (select 1 from public.order_items i join public.orders o on o.id=i.order_id
      where o.order_number=(r->>'order_number')::bigint and i.product_name_fr='Simple' and i.unit_final_price=80 and i.unit_price=100)
  then raise exception 'FAIL snapshot'; end if;

  -- 4. variant product: available variant OK
  perform public.create_order(
    '{"full_name":"Test User","phone":"0612345678","city":"Fes","address":"12 rue test"}'::jsonb,
    '[{"product_id":"00000000-0000-0000-0000-0000000000a2","variant_id":"00000000-0000-0000-0000-0000000000b1","quantity":1}]'::jsonb);
end $$;

-- 5. rejections
select pg_temp.expect_error('variant_unavailable','[{"product_id":"00000000-0000-0000-0000-0000000000a2","variant_id":"00000000-0000-0000-0000-0000000000b2","quantity":1}]');
select pg_temp.expect_error('variant_required','[{"product_id":"00000000-0000-0000-0000-0000000000a2","quantity":1}]');
select pg_temp.expect_error('product_unavailable','[{"product_id":"00000000-0000-0000-0000-0000000000a3","quantity":1}]');
select pg_temp.expect_error('product_unavailable','[{"product_id":"00000000-0000-0000-0000-0000000000a4","quantity":1}]');
select pg_temp.expect_error('invalid_quantity','[{"product_id":"00000000-0000-0000-0000-0000000000a1","quantity":99}]');
select pg_temp.expect_error('invalid_items','[]');
select pg_temp.expect_error('invalid_items','[{"product_id":"nope","quantity":1}]');
select pg_temp.expect_error('invalid_phone','[{"product_id":"00000000-0000-0000-0000-0000000000a1","quantity":1}]','123');

-- 6. a failed order leaves nothing behind (atomicity): count unchanged by rejections above
do $$ begin
  if (select count(*) from public.orders) <> (select n from _base) + 3 then raise exception 'FAIL partial/extra orders exist'; end if;
end $$;

-- 7. permissions: anonymous visitors
set local role anon;
do $$
declare ok boolean := false;
begin
  begin perform 1 from public.orders limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can read orders'; end if;
  ok := false;
  begin perform 1 from public.customers limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can read customers'; end if;
  ok := false;
  begin perform public.set_order_status('00000000-0000-0000-0000-000000000000','confirmed'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can call set_order_status'; end if;
  ok := false;
  begin insert into public.products (slug,name_ar,name_fr,price) values ('x','x','x',1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can insert products'; end if;
  if exists (select 1 from public.products where slug = 't-hidden') then raise exception 'FAIL anon sees hidden product'; end if;
  if not exists (select 1 from public.products where slug = 't-simple') then raise exception 'FAIL anon cannot see published product'; end if;
end $$;
reset role;

-- 8. permissions: an authenticated user WITHOUT staff role
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare ok boolean := false;
begin
  if (select count(*) from public.orders) <> 0 then raise exception 'FAIL non-staff reads orders'; end if;
  begin perform public.set_order_status((select id from public.orders limit 1),'confirmed'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL non-staff changed status'; end if;
end $$;
reset role;

do $$ begin raise notice 'ALL DB TESTS PASSED (transaction will be rolled back)'; end $$;
rollback;
