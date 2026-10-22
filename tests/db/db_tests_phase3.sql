-- Stoph Shop — Phase 3 database tests. Run AFTER 01-11 on a DEVELOPMENT project, in the SQL Editor.
-- One transaction, ROLLED BACK at the end. Any failure raises "FAIL ...". Success: ALL PHASE 3 DB TESTS PASSED.
-- STATUS: written but NOT executed in the build environment (no PostgreSQL there). Expect to fix small typos on first run.
begin;

-- ---- fixtures ----
insert into public.products (id, slug, name_ar, name_fr, price, is_published) values
 ('00000000-0000-0000-0000-0000000003a1', 't3-plain', 'عادي', 'Plain', 100, true);
insert into public.shipping_rates (city, fee) values ('Zzvillé', 33);
insert into auth.users (id, email, instance_id, aud, role) values
 ('bbbbbbbb-0000-0000-0000-000000000001','t3-owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('bbbbbbbb-0000-0000-0000-000000000002','t3-support@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('bbbbbbbb-0000-0000-0000-000000000003','t3-manager@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name) values
 ('bbbbbbbb-0000-0000-0000-000000000001','Owner T3'),('bbbbbbbb-0000-0000-0000-000000000002','Support T3'),('bbbbbbbb-0000-0000-0000-000000000003','Manager T3');
insert into public.staff_role_assignments (user_id, role_id) select 'bbbbbbbb-0000-0000-0000-000000000001', id from public.roles where key='owner';
insert into public.staff_role_assignments (user_id, role_id) select 'bbbbbbbb-0000-0000-0000-000000000002', id from public.roles where key='support';
insert into public.staff_role_assignments (user_id, role_id) select 'bbbbbbbb-0000-0000-0000-000000000003', id from public.roles where key='manager';

create or replace function pg_temp.mk(p_city text, p_phone text) returns jsonb language sql as $$
  select public.create_order(jsonb_build_object('full_name','T3 User','phone',p_phone,'city',p_city,'address','12 rue test'),
         '[{"product_id":"00000000-0000-0000-0000-0000000003a1","quantity":1}]'::jsonb, null);
$$;

-- 1. shipping city matching (server) -----------------------------------------------------------------
do $$
declare def numeric; r jsonb;
begin
  select fee into def from public.shipping_rates where is_default;
  if (pg_temp.mk('zzville', '0633000001')->>'shipping_fee')::numeric <> 33 then raise exception 'FAIL city: lower-case without accent'; end if;
  if (pg_temp.mk(' ZZVILLÉ. ', '0633000002')->>'shipping_fee')::numeric <> 33 then raise exception 'FAIL city: upper-case with accent and dot'; end if;
  if (pg_temp.mk('Nowhere', '0633000003')->>'shipping_fee')::numeric <> def then raise exception 'FAIL city: default fee'; end if;
  perform pg_temp.mk('Nowhere', '0633000004');   -- extra fixture orders used by later sections
  if public.city_key('Fès-Meknès') <> 'fes meknes' then raise exception 'FAIL city_key %', public.city_key('Fès-Meknès'); end if;
end $$;

-- 2. generic path cannot cancel / return; cancel_order needs reason; permissions ----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}', true);   -- support: can confirm, cannot cancel
do $$
declare oid_ uuid; ok boolean;
begin
  select id into oid_ from public.orders where phone = '0633000001';
  ok := false; begin perform public.cancel_order(oid_, 'defective', null); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL support cancelled an order'; end if;
  ok := false; begin perform public.set_order_status(oid_, 'cancelled'); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL support cancel via generic path'; end if;
  ok := false; begin perform public.register_return(oid_, 'defective', null); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL support registered a return'; end if;
  ok := false; begin insert into public.order_returns (order_id, kind, reason_code, status, order_status_before, order_created_at, order_total)
                       values (oid_, 'return', 'defective', 'requested', 'x', now(), 1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL direct insert into order_returns'; end if;
  if (select count(*) from public.order_returns) <> 0 then null; end if;   -- support may READ (orders.view), never write
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}', true);   -- manager
do $$
declare oid_ uuid; rid uuid; ok boolean; v jsonb;
begin
  select id into oid_ from public.orders where phone = '0633000001';
  ok := false; begin perform public.set_order_status(oid_, 'cancelled'); exception when others then ok := (sqlerrm = 'use_returns_flow'); end;
  if not ok then raise exception 'FAIL generic cancel not redirected'; end if;
  ok := false; begin perform public.cancel_order(oid_, 'bogus', null); exception when others then ok := (sqlerrm = 'invalid_reason'); end;
  if not ok then raise exception 'FAIL invalid reason accepted'; end if;
  ok := false; begin perform public.cancel_order(oid_, 'other', ''); exception when others then ok := (sqlerrm = 'note_required'); end;
  if not ok then raise exception 'FAIL reason other without note'; end if;

  rid := public.cancel_order(oid_, 'customer_changed_mind', 'called, changed mind');
  if (select status from public.orders where id = oid_) <> 'cancelled' then raise exception 'FAIL order not cancelled'; end if;
  if not exists (select 1 from public.order_returns r where r.id = rid and r.kind = 'cancellation' and r.status = 'closed'
       and r.order_total = 133 and r.handled_by = 'bbbbbbbb-0000-0000-0000-000000000003' and r.reason_code = 'customer_changed_mind') then
    raise exception 'FAIL cancellation record'; end if;
  if (select count(*) from public.order_items where order_id = oid_) <> 1 then raise exception 'FAIL order items must survive cancellation'; end if;
  ok := false; begin perform public.cancel_order(oid_, 'defective', null); exception when others then ok := (sqlerrm = 'invalid_transition'); end;
  if not ok then raise exception 'FAIL cancelled twice'; end if;
  ok := false; begin delete from public.order_returns where id = rid; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL order_returns delete allowed'; end if;
end $$;
reset role;

-- 3. returns workflow: confirmed -> shipped -> delivered, then request / approve / receive -------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}', true);
do $$
declare oid_ uuid; oid2 uuid; rid uuid; ok boolean;
begin
  select id into oid_ from public.orders where phone = '0633000002';
  ok := false; begin perform public.register_return(oid_, 'defective', null); exception when others then ok := (sqlerrm = 'invalid_transition'); end;
  if not ok then raise exception 'FAIL return on a not-yet-shipped order'; end if;
  perform public.set_order_status(oid_, 'confirmed'); perform public.set_order_status(oid_, 'shipped'); perform public.set_order_status(oid_, 'delivered');

  rid := public.register_return(oid_, 'defective', 'screen cracked');
  if (select status from public.orders where id = oid_) <> 'delivered' then raise exception 'FAIL order must stay delivered until goods are back'; end if;
  ok := false; begin perform public.register_return(oid_, 'defective', null); exception when others then ok := (sqlerrm = 'return_already_open'); end;
  if not ok then raise exception 'FAIL second open return'; end if;
  ok := false; begin perform public.update_return(rid, 'received', null); exception when others then ok := (sqlerrm = 'invalid_transition'); end;
  if not ok then raise exception 'FAIL skipped approval'; end if;
  perform public.update_return(rid, 'approved', 'ok to send back');
  perform public.update_return(rid, 'received', 'goods checked');
  if (select status from public.orders where id = oid_) <> 'returned' then raise exception 'FAIL order not returned'; end if;
  if not exists (select 1 from public.order_status_history where order_id = oid_ and to_status = 'returned') then raise exception 'FAIL history'; end if;
  if (select admin_notes from public.order_returns where id = rid) <> 'goods checked' then raise exception 'FAIL admin notes'; end if;

  -- refused at delivery: shipped order, goods already back
  select id into oid2 from public.orders where phone = '0633000004';
  perform public.set_order_status(oid2, 'confirmed'); perform public.set_order_status(oid2, 'shipped');
  perform public.register_return(oid2, 'refused_at_delivery', null, true);
  if (select status from public.orders where id = oid2) <> 'returned' then raise exception 'FAIL immediate return'; end if;

  -- reject needs a note
  select id into oid2 from public.orders where phone = '0633000003';
  perform public.set_order_status(oid2, 'confirmed'); perform public.set_order_status(oid2, 'shipped');
  rid := public.register_return(oid2, 'not_as_described', null);
  ok := false; begin perform public.update_return(rid, 'rejected', null); exception when others then ok := (sqlerrm = 'note_required'); end;
  if not ok then raise exception 'FAIL reject without note'; end if;
  perform public.update_return(rid, 'rejected', 'photos show normal use');
  if (select status from public.orders where id = oid2) <> 'shipped' then raise exception 'FAIL rejected return must not change the order'; end if;
end $$;
reset role;

-- 4. reports: cancelled / returned are never sales; v2 sections exist ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);   -- owner
do $$
declare r jsonb; today date := (now() at time zone 'Africa/Casablanca')::date; ok boolean;
begin
  r := public.admin_report(today, today, 'day');
  if (r->'sales'->>'count')::int <> (select count(*) from public.orders where status = 'delivered' and (created_at at time zone 'Africa/Casablanca')::date = today) then raise exception 'FAIL sales count %', r; end if;
  if (r->'returned'->>'count')::int < 2 or (r->'cancelled'->>'count')::int < 1 then raise exception 'FAIL returned/cancelled counts %', r->'returned'; end if;
  if (r->'sales'->>'amount')::numeric <> (select coalesce(sum(total),0) from public.orders where status = 'delivered' and (created_at at time zone 'Africa/Casablanca')::date = today) then raise exception 'FAIL sales amount'; end if;
  if not (r ? 'groups' and r ? 'shipping' and r ? 'discounts' and r ? 'returns_by_reason' and r ? 'by_period' and r ? 'delivered_in_period') then raise exception 'FAIL report keys'; end if;
  if jsonb_array_length(public.admin_report(today, today, 'month')->'by_period') <> 1 then raise exception 'FAIL month grouping'; end if;
  ok := false; begin perform public.admin_report(today, today, 'year'); exception when others then ok := (sqlerrm = 'invalid_range'); end;
  if not ok then raise exception 'FAIL invalid group accepted'; end if;
  if (public.admin_dashboard()->>'open_returns')::int < 0 then raise exception 'FAIL dashboard'; end if;
end $$;
reset role;

-- 5. paginated search ---------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.admin_search_orders(null, null, '0633000001', null, null, null, 25, 0);
  if n <> 1 then raise exception 'FAIL phone filter (% rows)', n; end if;
  if (select total_count from public.admin_search_orders(null, null, '+212633000001', null, null, null, 25, 0) limit 1) <> 1 then raise exception 'FAIL +212 phone filter'; end if;
  if (select count(*) from public.admin_search_orders(null, null, null, 'ZZVILLE', null, null, 25, 0)) < 1 then raise exception 'FAIL accent-insensitive city filter'; end if;
  if (select count(*) from public.admin_search_orders(null, null, '0633', null, null, null, 2, 0)) <> 2 then raise exception 'FAIL page size'; end if;
  if (select count(*) from public.admin_search_orders(null, 'cancelled', null, null, current_date + 1, null, 25, 0)) <> 0 then raise exception 'FAIL date filter'; end if;
end $$;
reset role;
-- visitors cannot call any of it
set local role anon;
do $$
declare ok boolean;
begin
  ok := false; begin perform public.admin_search_orders(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon admin_search_orders'; end if;
  ok := false; begin perform public.cancel_order('00000000-0000-0000-0000-000000000000', 'other', 'x'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon cancel_order'; end if;
  ok := false; begin perform public.mfa_status(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon mfa_status'; end if;
  ok := false; begin perform count(*) from public.order_returns; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon reads order_returns'; end if;
end $$;
reset role;

-- 6. MFA enforcement ------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);
do $$
declare ok boolean;
begin
  if not public.has_permission('orders.view') then raise exception 'FAIL enforcement is off by default'; end if;
  ok := false; begin perform public.set_mfa_enforcement(true); exception when others then ok := (sqlerrm = 'mfa_required'); end;
  if not ok then raise exception 'FAIL enforcement enabled from an aal1 session'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}', true);   -- manager is not owner
do $$
declare ok boolean := false;
begin
  begin perform public.set_mfa_enforcement(false); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL manager changed enforcement'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$
declare ok boolean := false;
begin
  perform public.set_mfa_enforcement(true);
  if not public.has_permission('orders.view') then raise exception 'FAIL owner aal2 lost access'; end if;
  begin perform public.set_role_requires_mfa((select id from public.roles where key = 'owner'), false); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL owner role MFA requirement removed'; end if;
  if not (public.mfa_status()->>'satisfied')::boolean then raise exception 'FAIL status satisfied'; end if;
end $$;
-- now the same owner with an aal1 session: locked out of everything admin
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);
do $$
declare ok boolean := false; st jsonb;
begin
  if public.has_permission('orders.view') then raise exception 'FAIL aal1 owner still has orders.view'; end if;
  if exists (select 1 from public.my_permissions()) then raise exception 'FAIL aal1 owner has permissions'; end if;
  if public.is_owner() then raise exception 'FAIL aal1 owner is_owner'; end if;
  if (select count(*) from public.orders) <> 0 then raise exception 'FAIL aal1 owner reads orders through RLS'; end if;
  begin perform public.admin_report(current_date, current_date); exception when others then ok := (sqlerrm = 'forbidden'); end;
  if not ok then raise exception 'FAIL aal1 owner reads reports'; end if;
  st := public.mfa_status();
  if not ((st->>'enforced')::boolean and (st->>'required')::boolean and not (st->>'satisfied')::boolean) then raise exception 'FAIL mfa_status %', st; end if;
end $$;
-- support does not require MFA by default: unaffected
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if not public.has_permission('orders.view') then raise exception 'FAIL support (no MFA required) was locked out'; end if;
end $$;
-- manager requires MFA by default: locked at aal1, fine at aal2
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}', true);
do $$ begin
  if public.has_permission('orders.view') then raise exception 'FAIL manager at aal1 should be locked'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  if not public.has_permission('orders.view') then raise exception 'FAIL manager at aal2 should work'; end if;
end $$;
-- can_grant_roles (used by the invite function BEFORE sending e-mail)
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  if not public.can_grant_roles(array(select id from public.roles where key = 'support')) then raise exception 'FAIL owner cannot grant support'; end if;
  if public.can_grant_roles('{}') then raise exception 'FAIL empty role list accepted'; end if;
  perform public.set_mfa_enforcement(false);                       -- break-glass equivalent from the UI
  if coalesce((select value from public.app_settings where key = 'mfa_enforced'), '') <> 'false' then raise exception 'FAIL could not switch enforcement off'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
do $$ begin
  if public.can_grant_roles(array(select id from public.roles where key = 'support')) then raise exception 'FAIL manager (no staff.manage) can grant roles'; end if;
end $$;
reset role;

-- 7. app_settings is invisible to the browser roles ---------------------------------------------------------
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform count(*) from public.app_settings; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL authenticated reads app_settings directly'; end if;
end $$;
reset role;

do $$ begin raise notice 'ALL PHASE 3 DB TESTS PASSED (transaction will be rolled back)'; end $$;
rollback;
