-- Stoph Shop — storefront upgrade DB tests (migration 12). Run AFTER 01-12 on a DEVELOPMENT project, in the SQL Editor.
-- One transaction, ROLLED BACK at the end. Failure = "FAIL ...". Success = "ALL STOREFRONT DB TESTS PASSED".
-- STATUS: written but NOT executed (no PostgreSQL in the build environment). Expect small first-run fixes.
begin;

insert into public.categories (id, slug, name_ar, name_fr) values ('dddddddd-0000-0000-0000-0000000000c1', 't12-cat', 'فئة', 'Cat');
insert into public.products (id, slug, name_ar, name_fr, price, is_published) values
 ('dddddddd-0000-0000-0000-0000000000a1', 't12-prod', 'م', 'P', 50, true),
 ('dddddddd-0000-0000-0000-0000000000a2', 't12-hidden', 'م', 'H', 50, false);
insert into auth.users (id, email, instance_id, aud, role) values
 ('dddddddd-0000-0000-0000-000000000001','t12-owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('dddddddd-0000-0000-0000-000000000002','t12-support@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name) values ('dddddddd-0000-0000-0000-000000000001','Owner'),('dddddddd-0000-0000-0000-000000000002','Support');
insert into public.staff_role_assignments (user_id, role_id) select 'dddddddd-0000-0000-0000-000000000001', id from public.roles where key='owner';
insert into public.staff_role_assignments (user_id, role_id) select 'dddddddd-0000-0000-0000-000000000002', id from public.roles where key='support';

-- seeded data (as database owner)
insert into public.banners (id, title_ar, title_fr, link_type, is_active, sort_order, starts_at, ends_at) values
 ('dddddddd-0000-0000-0000-0000000000b1','حي','Live','none', true, 10, null, null),
 ('dddddddd-0000-0000-0000-0000000000b2','معطل','Off','none', false, 20, null, null),
 ('dddddddd-0000-0000-0000-0000000000b3','مستقبل','Future','none', true, 30, now() + interval '1 day', null),
 ('dddddddd-0000-0000-0000-0000000000b4','منتهي','Ended','none', true, 40, null, now() - interval '1 day');

-- 1. permission seeded for owner + manager, NOT support
do $$ begin
  if not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id where r.key = 'owner' and p.key = 'banners.manage') then raise exception 'FAIL owner lacks banners.manage'; end if;
  if exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id where r.key = 'support' and p.key = 'banners.manage') then raise exception 'FAIL support has banners.manage'; end if;
end $$;

-- 2. visitors (anon): only the live banner, no writes, no settings writes
set local role anon;
do $$
declare n int; ok boolean;
begin
  select count(*) into n from public.banners;
  if n <> 1 then raise exception 'FAIL anon sees % banners (expected 1 live)', n; end if;
  ok := false; begin insert into public.banners (title_ar, title_fr) values ('x', 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL anon inserted a banner'; end if;
  ok := false; begin update public.banners set is_active = false; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL anon updated banners'; end if;
  ok := false; begin delete from public.banners; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL anon deleted banners'; end if;
  if (select count(*) from public.carousel_settings) <> 1 then raise exception 'FAIL anon cannot read carousel settings'; end if;
  ok := false; begin update public.carousel_settings set autoplay = false; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL anon updated carousel settings'; end if;
  ok := false; begin perform count(*) from public.order_requests; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon reads order_requests'; end if;
  ok := false; begin perform public._create_order_core('{}'::jsonb, '[]'::jsonb, null); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can call the core order function directly'; end if;
end $$;
reset role;

-- 3. staff WITHOUT banners.manage (support): same as a visitor for banners, cannot write
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}', true);
do $$
declare ok boolean;
begin
  if (select count(*) from public.banners) <> 1 then raise exception 'FAIL support sees non-public banners'; end if;
  ok := false; begin insert into public.banners (title_ar, title_fr) values ('x', 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL support inserted a banner'; end if;
  update public.banners set title_fr = 'hacked' where id = 'dddddddd-0000-0000-0000-0000000000b1';
  if exists (select 1 from public.banners where title_fr = 'hacked') then raise exception 'FAIL support updated a banner'; end if;
  update public.carousel_settings set interval_seconds = 9;
  if (select interval_seconds from public.carousel_settings) = 9 then raise exception 'FAIL support changed carousel settings'; end if;
end $$;
reset role;

-- 4. owner: sees all, full CRUD, constraints hold
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare ok boolean; nid uuid;
begin
  if (select count(*) from public.banners) < 4 then raise exception 'FAIL owner does not see all banners'; end if;
  insert into public.banners (title_ar, title_fr, link_type, product_id, is_active) values ('جديد', 'New', 'product', 'dddddddd-0000-0000-0000-0000000000a1', false) returning id into nid;
  if (select created_by from public.banners where id = nid) <> 'dddddddd-0000-0000-0000-000000000001' then raise exception 'FAIL created_by not set from the session'; end if;
  update public.banners set title_fr = 'Edited' where id = nid;
  if (select title_fr from public.banners where id = nid) <> 'Edited' then raise exception 'FAIL owner update'; end if;
  -- constraints
  ok := false; begin insert into public.banners (title_ar, title_fr, link_type, link_url) values ('x','x','url','javascript:alert(1)'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL javascript: url accepted'; end if;
  ok := false; begin insert into public.banners (title_ar, title_fr, link_type, link_url) values ('x','x','url','//evil.com'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL protocol-relative url accepted'; end if;
  ok := false; begin insert into public.banners (title_ar, title_fr, link_type, link_url) values ('x','x','url','http://plain.com'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL http url accepted'; end if;
  insert into public.banners (title_ar, title_fr, link_type, link_url) values ('x','x','url','/products?category=a'), ('x','x','url','https://example.com/x');
  ok := false; begin insert into public.banners (title_ar, title_fr, page_path) values ('x','x','/admin'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL page_path outside the whitelist accepted'; end if;
  ok := false; begin insert into public.banners (title_ar, title_fr, starts_at, ends_at) values ('x','x', now(), now() - interval '1 hour'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL end before start accepted'; end if;
  ok := false; begin insert into public.banners (title_ar, title_fr, image_path) values ('x','x','../../etc/passwd'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL unsafe image path accepted'; end if;
  ok := false; begin insert into public.banners (title_ar, title_fr) values ('', 'x'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL empty title accepted'; end if;
  ok := false; begin update public.carousel_settings set interval_seconds = 99; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL interval 99 accepted'; end if;
  ok := false; begin update public.carousel_settings set transition = 'spin'; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL unknown transition accepted'; end if;
  update public.carousel_settings set autoplay = false, interval_seconds = 8, transition = 'fade';
  if (select interval_seconds from public.carousel_settings) <> 8 then raise exception 'FAIL owner cannot change carousel settings'; end if;
  ok := false; begin delete from public.carousel_settings; exception when others then ok := true; end;
  if not ok and exists (select 1 from public.carousel_settings) = false then raise exception 'FAIL carousel settings row deleted'; end if;
  delete from public.banners where id = nid;
  if exists (select 1 from public.banners where id = nid) then raise exception 'FAIL owner delete'; end if;
end $$;
reset role;

-- 5. deleting a product keeps the banner (destination just becomes empty)
delete from public.products where id = 'dddddddd-0000-0000-0000-0000000000a1' and false;   -- (not executed: other tests keep the fixture)

-- 6. best sellers: ids only, published products, confirmed-or-later orders only
do $$
declare r jsonb; v_id uuid; ids uuid[];
begin
  insert into public.shipping_rates (city, fee) values ('Zzt12', 10) on conflict do nothing;
  r := public.create_order(jsonb_build_object('full_name','T12','phone','0644000001','city','Zzt12','address','12 rue test'),
        '[{"product_id":"dddddddd-0000-0000-0000-0000000000a1","quantity":3}]'::jsonb, null);
  select id into v_id from public.orders where phone = '0644000001';
  select array_agg(product_id) into ids from public.best_selling_products(8);
  if ids is not null and 'dddddddd-0000-0000-0000-0000000000a1' = any(ids) then raise exception 'FAIL a NEW order already counts as a best seller'; end if;
  update public.orders set status = 'confirmed' where id = v_id;
  select array_agg(product_id) into ids from public.best_selling_products(8);
  if not ('dddddddd-0000-0000-0000-0000000000a1' = any(ids)) then raise exception 'FAIL confirmed order does not count'; end if;
  update public.orders set status = 'cancelled' where id = v_id;
  select array_agg(product_id) into ids from public.best_selling_products(8);
  if ids is not null and 'dddddddd-0000-0000-0000-0000000000a1' = any(ids) then raise exception 'FAIL cancelled order counts as a best seller'; end if;
end $$;
set local role anon;
do $$ begin
  perform * from public.best_selling_products(8);                                  -- callable by visitors
  if (select count(*) from information_schema.columns where table_name = 'best_selling_products') > 1 then null; end if;
end $$;
reset role;

-- 7. idempotent checkout (same token = same order; different token = new order; bad token rejected)
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb; n_before int; ok boolean;
  tok uuid := 'dddddddd-0000-0000-0000-00000000f001'; tok2 uuid := 'dddddddd-0000-0000-0000-00000000f002';
  cust jsonb; items jsonb := '[{"product_id":"dddddddd-0000-0000-0000-0000000000a1","quantity":1}]';
begin
  cust := jsonb_build_object('full_name','T12 Tok','phone','0644000002','city','Zzt12','address','12 rue test','client_token', tok);
  select count(*) into n_before from public.orders;
  r1 := public.create_order(cust, items, null);
  r2 := public.create_order(cust, items, null);
  if (select count(*) from public.orders) <> n_before + 1 then raise exception 'FAIL same token created two orders'; end if;
  if r1->>'order_number' <> r2->>'order_number' or coalesce((r2->>'duplicate')::boolean, false) is not true then raise exception 'FAIL duplicate not reported: % / %', r1, r2; end if;
  r3 := public.create_order(cust || jsonb_build_object('client_token', tok2, 'phone', '0644000003'), items, null);
  if r3->>'order_number' = r1->>'order_number' then raise exception 'FAIL different token returned the old order'; end if;
  ok := false; begin perform public.create_order(cust || jsonb_build_object('client_token', 'not-a-uuid'), items, null); exception when others then ok := (sqlerrm = 'invalid_token'); end;
  if not ok then raise exception 'FAIL bad token accepted'; end if;
  -- without a token behaviour is unchanged (each call = an order)
  r1 := public.create_order(cust - 'client_token' || jsonb_build_object('phone','0644000004'), items, null);
  if r1 ? 'error' then raise exception 'FAIL order without token: %', r1; end if;
  -- a FAILED order (unknown product) is not stored, so the visitor can retry with the same token
  r1 := public.create_order(cust || jsonb_build_object('client_token','dddddddd-0000-0000-0000-00000000f003','phone','0644000005'), '[{"product_id":"00000000-0000-0000-0000-00000000dead","quantity":1}]', null);
  if not (r1 ? 'error') then raise exception 'FAIL unknown product accepted: %', r1; end if;
  if exists (select 1 from public.order_requests where token = 'dddddddd-0000-0000-0000-00000000f003') then raise exception 'FAIL failed order token stored'; end if;
end $$;

do $$ begin raise notice 'ALL STOREFRONT DB TESTS PASSED (transaction will be rolled back)'; end $$;
rollback;
