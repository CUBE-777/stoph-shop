-- Stoph Shop — Phase 2 database tests. Run AFTER 01-09 on a DEVELOPMENT project, in the SQL Editor.
-- Runs inside a transaction that is ROLLED BACK. Any failure raises an exception with "FAIL ...".
-- Success message: ALL PHASE 2 DB TESTS PASSED.
-- NOTE (Phase 3): run this file AFTER migrations 10 and 11 too; the cancel step now uses cancel_order().
begin;

create temp table _base as select count(*)::int as n from public.orders;

-- ---- fixtures ----
insert into public.categories (id, slug, name_ar, name_fr) values ('00000000-0000-0000-0000-0000000000c1','t2-cat','ت','T');
insert into public.products (id, category_id, slug, name_ar, name_fr, price, sale_price, sale_starts_at, sale_ends_at, is_published) values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','t2-plain','عادي','Plain',100,null,null,null,true),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1','t2-sale-active','مخفض','SaleOn',100,70,now() - interval '1 day', now() + interval '1 day',true),
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000c1','t2-sale-expired','منتهي','SaleOff',100,70,now() - interval '3 day', now() - interval '1 day',true);
insert into public.coupons (id, code, discount_type, value, min_order, max_discount, one_per_phone, is_active) values
 ('00000000-0000-0000-0000-0000000000d1','PCT10','percent',10,0,null,false,true),
 ('00000000-0000-0000-0000-0000000000d2','FIX500','fixed',500,0,null,false,true),
 ('00000000-0000-0000-0000-0000000000d3','MIN300','fixed',20,300,null,false,true),
 ('00000000-0000-0000-0000-0000000000d4','OFF','fixed',10,0,null,false,false),
 ('00000000-0000-0000-0000-0000000000d5','ONCE','fixed',10,0,null,true,true),
 ('00000000-0000-0000-0000-0000000000d6','CAP','percent',50,0,15,false,true);
insert into public.coupons (code, discount_type, value, ends_at) values ('EXPIRED','fixed',10, now() - interval '1 hour');
insert into public.coupons (code, discount_type, value, max_uses, used_count) values ('FULL','fixed',10, 1, 1);

create or replace function pg_temp.mk(p_items jsonb, p_coupon text default null, p_phone text default '0612345678', p_name text default 'Test User')
returns jsonb language sql as $$
  select public.create_order(jsonb_build_object('full_name', p_name, 'phone', p_phone, 'city', 'Fes', 'address', '12 rue test'), p_items, p_coupon);
$$;
create or replace function pg_temp.expect(p_code text, p_fn text) returns void language plpgsql as $$
begin
  execute p_fn;
  raise exception 'FAIL: expected % but nothing was raised', p_code;
exception when others then
  if sqlerrm <> p_code then raise exception 'FAIL: expected %, got %', p_code, sqlerrm; end if;
end $$;

do $$
declare r jsonb; o record; k int;
  plain constant jsonb := '[{"product_id":"00000000-0000-0000-0000-0000000000a1","quantity":2}]';
begin
  -- 1. phone normalisation (server)
  if public.normalize_ma_phone('+212 612-345-678') <> '0612345678' then raise exception 'FAIL normalize +212'; end if;
  if public.normalize_ma_phone('٠٦١٢٣٤٥٦٧٨') <> '0612345678' then raise exception 'FAIL normalize arabic digits'; end if;
  if public.normalize_ma_phone('0412345678') is not null then raise exception 'FAIL normalize invalid'; end if;

  -- 2. sale window: active sale applies, expired sale is ignored (server clock)
  r := pg_temp.mk('[{"product_id":"00000000-0000-0000-0000-0000000000a2","quantity":1}]');
  if (r->>'subtotal')::numeric <> 70 then raise exception 'FAIL active sale %', r; end if;
  r := pg_temp.mk('[{"product_id":"00000000-0000-0000-0000-0000000000a3","quantity":1}]');
  if (r->>'subtotal')::numeric <> 100 then raise exception 'FAIL expired sale %', r; end if;

  -- 3. percent coupon: 10% of 200 = 20, stored on the order
  r := pg_temp.mk(plain, 'pct10');
  if (r->>'coupon_discount')::numeric <> 20 then raise exception 'FAIL pct coupon %', r; end if;
  if (r->>'total')::numeric <> 200 - 20 + (r->>'shipping_fee')::numeric then raise exception 'FAIL coupon total %', r; end if;
  select * into o from public.orders where order_number = (r->>'order_number')::bigint;
  if o.coupon_discount <> 20 or o.coupon_code <> 'PCT10' then raise exception 'FAIL coupon snapshot'; end if;
  if (select used_count from public.coupons where code = 'PCT10') <> 1 then raise exception 'FAIL used_count'; end if;
  if not exists (select 1 from public.coupon_redemptions where order_id = o.id) then raise exception 'FAIL redemption'; end if;

  -- 4. fixed coupon can never exceed the subtotal; percent cap respected
  r := pg_temp.mk(plain, 'FIX500');
  if (r->>'coupon_discount')::numeric <> 200 then raise exception 'FAIL fixed coupon cap to subtotal %', r; end if;
  r := pg_temp.mk(plain, 'CAP');
  if (r->>'coupon_discount')::numeric <> 15 then raise exception 'FAIL max_discount %', r; end if;

  -- 5. coupon errors are RETURNED (so attempts can be logged), never applied
  for k in 1..1 loop
    r := pg_temp.mk(plain, 'NOPE', '0644444444');    if r->>'error' <> 'coupon_invalid' then raise exception 'FAIL unknown coupon %', r; end if;
    r := pg_temp.mk(plain, 'OFF', '0644444444');     if r->>'error' <> 'coupon_invalid' then raise exception 'FAIL inactive coupon %', r; end if;
    r := pg_temp.mk(plain, 'EXPIRED', '0644444444'); if r->>'error' <> 'coupon_invalid' then raise exception 'FAIL expired coupon %', r; end if;
    r := pg_temp.mk(plain, 'FULL', '0644444444');    if r->>'error' <> 'coupon_invalid' then raise exception 'FAIL exhausted coupon %', r; end if;
    r := pg_temp.mk(plain, 'MIN300', '0644444444');  if r->>'error' <> 'coupon_min_order' then raise exception 'FAIL min order %', r; end if;
  end loop;

  -- 6. one use per phone
  r := pg_temp.mk(plain, 'ONCE', '0611111111');
  if r ? 'error' then raise exception 'FAIL first ONCE use %', r; end if;
  r := pg_temp.mk(plain, 'ONCE', '0611111111');
  if r->>'error' <> 'coupon_invalid' then raise exception 'FAIL second ONCE use %', r; end if;

  -- 7. customers: same phone+name = one record; same phone + other name = another record
  perform pg_temp.mk(plain, null, '0622222222', 'Sara B');
  perform pg_temp.mk(plain, null, '0622222222', '  sara   b ');
  perform pg_temp.mk(plain, null, '0622222222', 'Omar B');
  if (select count(*) from public.customers where phone = '0622222222') <> 2 then raise exception 'FAIL customer dedupe'; end if;

  -- 8. history row written on creation; tracking code generated and unguessable shape
  select * into o from public.orders where phone = '0622222222' order by created_at desc limit 1;
  if o.tracking_code !~ '^SS-[0-9A-F]{10}$' then raise exception 'FAIL tracking code %', o.tracking_code; end if;
  if not exists (select 1 from public.order_status_history where order_id = o.id and from_status is null) then raise exception 'FAIL history'; end if;
end $$;

-- 9. client-supplied prices are impossible: quote ignores any price keys
do $$
declare q jsonb;
begin
  q := public.quote_order('[{"product_id":"00000000-0000-0000-0000-0000000000a1","quantity":1,"price":1,"unit_price":1}]', 'Fes', null, null);
  if (q->>'subtotal')::numeric <> 100 then raise exception 'FAIL client price accepted %', q; end if;
end $$;

-- 10. tracking: right code+phone works; wrong phone looks identical to unknown code; no sensitive data
do $$
declare o record; t jsonb; bad jsonb; i int;
begin
  select * into o from public.orders where phone = '0622222222' order by created_at desc limit 1;
  t := public.track_order(lower(o.tracking_code), '+212622222222');
  if t->>'found' <> 'true' then raise exception 'FAIL tracking valid %', t; end if;
  if t::text ilike '%rue test%' or t::text ilike '%Omar%' or t ? 'address' or t ? 'phone' then raise exception 'FAIL tracking leaks data %', t; end if;
  bad := public.track_order(o.tracking_code, '0699999999');
  if bad <> jsonb_build_object('found', false) then raise exception 'FAIL tracking wrong phone %', bad; end if;
  bad := public.track_order('SS-0000000000', '0622222222');
  if bad <> jsonb_build_object('found', false) then raise exception 'FAIL tracking unknown code %', bad; end if;
  -- brute force on one code gets blocked (limit 8 failures / 15 min)
  for i in 1..10 loop
    begin perform public.track_order('SS-ABCDEF0123', '06' || lpad(i::text, 8, '0'));
    exception when others then if sqlerrm = 'rate_limited' then exit; else raise; end if; end;
  end loop;
  begin perform public.track_order('SS-ABCDEF0123', '0600000099'); raise exception 'FAIL not rate limited';
  exception when others then if sqlerrm <> 'rate_limited' then raise exception 'FAIL expected rate_limited, got %', sqlerrm; end if; end;
end $$;

-- 11. order spam limit: 5 orders / phone / hour
do $$
declare i int; blocked boolean := false;
begin
  for i in 1..7 loop
    begin perform pg_temp.mk('[{"product_id":"00000000-0000-0000-0000-0000000000a1","quantity":1}]', null, '0633333333');
    exception when others then if sqlerrm = 'rate_limited' then blocked := true; exit; else raise; end if; end;
  end loop;
  if not blocked then raise exception 'FAIL order rate limit'; end if;
end $$;

-- 12. anonymous visitors: no access to any new sensitive object
set local role anon;
do $$
declare ok boolean;
begin
  ok := false; begin perform 1 from public.coupons limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon reads coupons'; end if;
  ok := false; begin perform 1 from public.order_status_history limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon reads history'; end if;
  ok := false; begin perform 1 from public.rate_events limit 1; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon reads rate_events'; end if;
  ok := false; begin perform public.admin_report(current_date, current_date); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon runs report'; end if;
  ok := false; begin perform public.list_staff(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon lists staff'; end if;
end $$;
reset role;

-- 13. staff RBAC. Create two fake staff users directly (tests only; rolled back).
insert into auth.users (id, email, instance_id, aud, role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','t2-owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('aaaaaaaa-0000-0000-0000-000000000002','t2-support@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('aaaaaaaa-0000-0000-0000-000000000003','t2-manager@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','o'),('aaaaaaaa-0000-0000-0000-000000000002','s'),('aaaaaaaa-0000-0000-0000-000000000003','m');
insert into public.staff_role_assignments (user_id, role_id) select 'aaaaaaaa-0000-0000-0000-000000000001', id from public.roles where key='owner';
insert into public.staff_role_assignments (user_id, role_id) select 'aaaaaaaa-0000-0000-0000-000000000002', id from public.roles where key='support';
insert into public.staff_role_assignments (user_id, role_id) select 'aaaaaaaa-0000-0000-0000-000000000003', id from public.roles where key='manager';

-- 13a. support: can confirm, cannot cancel, cannot see reports/coupons, cannot self-promote
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare oid_ uuid; ok boolean;
begin
  select id into oid_ from public.orders where phone = '0622222222' limit 1;
  perform public.set_order_status(oid_, 'confirmed', 'called customer');
  if (select status from public.orders where id = oid_) <> 'confirmed' then raise exception 'FAIL support confirm'; end if;
  if not exists (select 1 from public.order_status_history where order_id = oid_ and to_status='confirmed' and changed_by='aaaaaaaa-0000-0000-0000-000000000002' and note='called customer') then raise exception 'FAIL history row'; end if;
  ok := false; begin perform public.set_order_status(oid_, 'cancelled'); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL support could cancel'; end if;
  ok := false; begin perform public.set_order_status(oid_, 'delivered'); exception when others then ok := (sqlerrm = 'invalid_transition'); end;
  if not ok then raise exception 'FAIL invalid transition allowed'; end if;
  ok := false; begin perform public.admin_report(current_date, current_date); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL support sees reports'; end if;
  if (select count(*) from public.coupons) <> 0 then raise exception 'FAIL support reads coupons'; end if;
  ok := false; begin insert into public.staff_role_assignments (user_id, role_id) select 'aaaaaaaa-0000-0000-0000-000000000002', id from public.roles where key='owner'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL direct self-grant'; end if;
  ok := false; begin perform public.set_staff_roles('aaaaaaaa-0000-0000-0000-000000000002', array(select id from public.roles where key='owner')); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL self role change'; end if;
  ok := false; begin update public.customers set phone = '0600000000'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL support changed phone'; end if;
  ok := false; begin delete from public.audit_logs; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL staff deleted audit'; end if;
end $$;
reset role;

-- 13b. manager (has staff.manage? no) cannot manage staff; owner can; owner role protected
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
declare ok boolean := false;
begin
  begin perform public.list_staff(); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL manager listed staff'; end if;
  if public.is_owner() then raise exception 'FAIL manager is owner'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
declare ok boolean := false;
begin
  perform public.set_staff_roles('aaaaaaaa-0000-0000-0000-000000000002', array(select id from public.roles where key in ('support','manager')));
  if (select count(*) from public.staff_role_assignments where user_id = 'aaaaaaaa-0000-0000-0000-000000000002') <> 2 then raise exception 'FAIL owner set roles'; end if;
  begin perform public.set_staff_active('aaaaaaaa-0000-0000-0000-000000000001', false); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL owner deactivated self'; end if;
  if not exists (select 1 from public.audit_logs where entity = 'staff_role_assignments') then raise exception 'FAIL role change not audited'; end if;
end $$;

-- 13c. owner walks one order through the workflow; report counts it as sales, cancelled stays separate
do $$
declare oid_ uuid; r jsonb; expected numeric; today date := (now() at time zone 'Africa/Casablanca')::date;
begin
  select id into oid_ from public.orders where phone = '0622222222' and status = 'confirmed' limit 1;
  perform public.set_order_status(oid_, 'preparing');
  perform public.set_order_status(oid_, 'shipped');
  perform public.set_order_status(oid_, 'delivered');
  perform public.cancel_order((select id from public.orders where phone = '0611111111' limit 1), 'customer_changed_mind', 'customer refused');  -- Phase 3: cancelling needs a reason record
  r := public.admin_report(today, today);
  select coalesce(sum(total), 0) into expected from public.orders
    where status = 'delivered' and (created_at at time zone 'Africa/Casablanca')::date = today;
  if (r->'sales'->>'amount')::numeric <> expected or (r->'sales'->>'count')::int < 1 then raise exception 'FAIL sales report %', r; end if;
  if (r->'cancelled'->>'count')::int < 1 then raise exception 'FAIL cancelled report %', r; end if;
  if (r->'sales'->>'amount')::numeric >= (select sum(total) from public.orders where (created_at at time zone 'Africa/Casablanca')::date = today)
     and (r->'cancelled'->>'amount')::numeric > 0 then raise exception 'FAIL sales include cancelled'; end if;
end $$;
reset role;

-- 14. audit log immutable even for the database owner
do $$
declare ok boolean := false;
begin
  begin delete from public.audit_logs; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL audit delete allowed'; end if;
  ok := false;
  begin update public.audit_logs set action = 'x'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL audit update allowed'; end if;
end $$;

do $$ begin raise notice 'ALL PHASE 2 DB TESTS PASSED (transaction will be rolled back)'; end $$;
rollback;
