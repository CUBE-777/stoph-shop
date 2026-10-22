-- Stoph Shop — Phase 3 / 11: returns & cancellations, shipping city matching, reports v2, paginated order search.
-- Run AFTER 10. One transaction. NOT executed in the build environment (no PostgreSQL) — test on a dev project first.
begin;

-- =========================================================
-- 1) City matching: "Fès", "fes", " FES " and "Fes." are the same city for shipping rates.
--    (Arabic spellings are NOT transliterated: add a separate rate row for each spelling you want to price.)
-- =========================================================
create or replace function public.city_key(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
    translate(lower(btrim(coalesce(p, ''))), 'àâäáãçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaceeeeiiiinooooouuuuyy'),
    '[\s\-_''’.]+', ' ', 'g'));
$$;

-- _price_order = unchanged from 08 except for the shipping lookup (city_key + deterministic order).
create or replace function public._price_order(p_items jsonb, p_city text, p_coupon text, p_phone text, p_lock boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb; v_prod public.products%rowtype; v_var public.product_variants%rowtype;
  v_qty int; v_orig numeric(10,2); v_unit numeric(10,2); v_sale_on boolean;
  v_subtotal numeric(10,2) := 0; v_pdisc numeric(10,2) := 0; v_cdisc numeric(10,2) := 0; v_fee numeric(10,2);
  v_lines jsonb := '[]'::jsonb;
  v_cp public.coupons%rowtype;
  v_code text := nullif(upper(btrim(coalesce(p_coupon, ''))), '');
  v_city text := btrim(coalesce(p_city, ''));
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'product_id', '') !~ v_uuid_re
       or coalesce(v_item->>'quantity', '') !~ '^[0-9]{1,2}$'
       or (v_item ? 'variant_id' and jsonb_typeof(v_item->'variant_id') <> 'null'
           and coalesce(v_item->>'variant_id', '') !~ v_uuid_re) then
      raise exception 'invalid_items';
    end if;
    v_qty := (v_item->>'quantity')::int;
    if v_qty < 1 or v_qty > 20 then raise exception 'invalid_quantity'; end if;

    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid and is_published for share;
    if not found then raise exception 'product_unavailable'; end if;

    v_var := null;
    if exists (select 1 from public.product_variants where product_id = v_prod.id) then
      if coalesce(v_item->>'variant_id', '') = '' then raise exception 'variant_required'; end if;
      select * into v_var from public.product_variants
        where id = (v_item->>'variant_id')::uuid and product_id = v_prod.id for share;
      if not found then raise exception 'invalid_variant'; end if;
      if not v_var.is_available then raise exception 'variant_unavailable'; end if;
    else
      if coalesce(v_item->>'variant_id', '') <> '' then raise exception 'invalid_variant'; end if;
      if not v_prod.is_available then raise exception 'product_unavailable'; end if;
    end if;

    v_orig := v_prod.price;
    v_sale_on := v_prod.sale_price is not null
      and (v_prod.sale_starts_at is null or v_prod.sale_starts_at <= now())
      and (v_prod.sale_ends_at is null or v_prod.sale_ends_at > now());
    v_unit := case when v_sale_on then v_prod.sale_price else v_prod.price end;
    v_subtotal := v_subtotal + v_unit * v_qty;
    v_pdisc := v_pdisc + (v_orig - v_unit) * v_qty;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_prod.id, 'variant_id', v_var.id,
      'name_ar', v_prod.name_ar, 'name_fr', v_prod.name_fr,
      'label_ar', v_var.label_ar, 'label_fr', v_var.label_fr,
      'unit_price', v_orig, 'discount', v_orig - v_unit, 'final', v_unit,
      'qty', v_qty, 'line_total', v_unit * v_qty);
  end loop;

  -- ---- coupon (all conditions checked here, never trusted from the browser) ----
  if v_code is not null then
    if p_lock then select * into v_cp from public.coupons where code = v_code for update;
    else select * into v_cp from public.coupons where code = v_code; end if;
    if not found or not v_cp.is_active
       or (v_cp.starts_at is not null and v_cp.starts_at > now())
       or (v_cp.ends_at is not null and v_cp.ends_at <= now())
       or (v_cp.max_uses is not null and v_cp.used_count >= v_cp.max_uses)
       or (v_cp.one_per_phone and p_phone is not null
           and exists (select 1 from public.coupon_redemptions r where r.coupon_id = v_cp.id and r.phone = p_phone)) then
      raise exception 'coupon_invalid';
    end if;
    if v_subtotal < v_cp.min_order then raise exception 'coupon_min_order'; end if;
    v_cdisc := case v_cp.discount_type when 'percent' then round(v_subtotal * v_cp.value / 100, 2) else v_cp.value end;
    if v_cp.max_discount is not null then v_cdisc := least(v_cdisc, v_cp.max_discount); end if;
    v_cdisc := least(v_cdisc, v_subtotal);        -- a coupon can never push the products below zero
  end if;

  -- ---- shipping: city rate, else default ----
  select fee into v_fee from public.shipping_rates
    where is_active and not is_default and public.city_key(city) = public.city_key(v_city)
    order by created_at limit 1;
  if v_fee is null then select fee into v_fee from public.shipping_rates where is_active and is_default limit 1; end if;
  if v_fee is null then raise exception 'shipping_unavailable'; end if;

  return jsonb_build_object('lines', v_lines, 'subtotal', v_subtotal, 'product_discount', v_pdisc,
    'coupon_id', v_cp.id, 'coupon_code', v_cp.code, 'coupon_discount', v_cdisc,
    'shipping_fee', v_fee, 'total', v_subtotal - v_cdisc + v_fee);
end $$;
revoke all on function public._price_order(jsonb, text, text, text, boolean) from public, anon, authenticated;

-- =========================================================
-- 2) Returns & cancellations. Every cancellation and every return leaves a row here; the order and its
--    items are never edited or deleted (order_returns.order_id is ON DELETE RESTRICT).
-- =========================================================
create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  kind text not null check (kind in ('return', 'cancellation')),
  reason_code text not null check (reason_code in (
    'customer_changed_mind', 'defective', 'wrong_item', 'not_as_described', 'refused_at_delivery',
    'unreachable', 'duplicate_order', 'out_of_stock', 'other')),
  reason_note text check (reason_note is null or char_length(reason_note) <= 500),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 1000),
  status text not null check (status in ('requested', 'approved', 'rejected', 'received', 'closed')),
  order_status_before text not null,
  order_created_at timestamptz not null,       -- snapshot: date of the original order
  order_total numeric(10,2) not null,          -- snapshot: amount of the original order
  requested_at timestamptz not null default now(),   -- date of the return request / cancellation
  resolved_at timestamptz,
  created_by uuid,
  handled_by uuid,                             -- staff member responsible (last one to act)
  updated_at timestamptz not null default now(),
  check ((kind = 'cancellation' and status = 'closed') or kind = 'return')
);
create index if not exists order_returns_order_idx on public.order_returns (order_id);
create index if not exists order_returns_status_idx on public.order_returns (status, requested_at desc);
create unique index if not exists order_returns_open_uq on public.order_returns (order_id)
  where kind = 'return' and status in ('requested', 'approved');
create unique index if not exists order_returns_cancel_uq on public.order_returns (order_id) where kind = 'cancellation';

alter table public.order_returns enable row level security;
revoke all on public.order_returns from anon, authenticated;
grant select on public.order_returns to authenticated;
drop policy if exists order_returns_staff_read on public.order_returns;
create policy order_returns_staff_read on public.order_returns for select to authenticated
  using ((select public.has_permission('orders.view')));

drop trigger if exists order_returns_touch on public.order_returns;
create trigger order_returns_touch before update on public.order_returns for each row execute function public.touch_updated_at();
drop trigger if exists audit_order_returns on public.order_returns;
create trigger audit_order_returns after insert or update on public.order_returns for each row execute function public.log_change();
create or replace function public.order_returns_no_delete() returns trigger language plpgsql as $$
begin raise exception 'order_returns rows are never deleted'; end $$;
drop trigger if exists order_returns_no_delete on public.order_returns;
create trigger order_returns_no_delete before delete on public.order_returns for each row execute function public.order_returns_no_delete();

-- Shared by every status change: transition table + permission + history + audit. Returns the previous status.
create or replace function public._apply_status(p_order_id uuid, p_status text, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare v_old text; v_perm text;
begin
  select status into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select required_permission into v_perm from public.order_transitions where from_status = v_old and to_status = p_status;
  if v_perm is null then raise exception 'invalid_transition'; end if;
  if not public.has_permission(v_perm) then raise exception 'forbidden'; end if;
  update public.orders set status = p_status where id = p_order_id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_old, p_status, (select auth.uid()), p_note);
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values ((select auth.uid()), 'STATUS', 'orders', p_order_id::text,
            jsonb_build_object('from', v_old, 'to', p_status, 'note', p_note));
  return v_old;
end $$;
revoke all on function public._apply_status(uuid, text, text) from public, anon, authenticated;

create or replace function public._check_reason(p_reason text, p_note text) returns text
language plpgsql immutable as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_reason is null or p_reason not in ('customer_changed_mind', 'defective', 'wrong_item', 'not_as_described',
       'refused_at_delivery', 'unreachable', 'duplicate_order', 'out_of_stock', 'other') then raise exception 'invalid_reason'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid_notes'; end if;
  if p_reason = 'other' and (v_note is null or char_length(v_note) < 3) then raise exception 'note_required'; end if;
  return v_note;
end $$;
revoke all on function public._check_reason(text, text) from public, anon, authenticated;

-- Generic path: cancelled / returned are NOT reachable from here any more (they need a reason record).
create or replace function public.set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if (select auth.uid()) is null then raise exception 'forbidden'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid_notes'; end if;
  if p_status in ('cancelled', 'returned') then
    if not public.has_permission('orders.cancel') then raise exception 'forbidden'; end if;
    raise exception 'use_returns_flow';
  end if;
  perform public._apply_status(p_order_id, p_status, v_note);
end $$;
revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

create or replace function public.cancel_order(p_order_id uuid, p_reason text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_note text; v_old text; v_o public.orders%rowtype; v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'forbidden'; end if;
  v_note := public._check_reason(p_reason, p_note);
  v_old := public._apply_status(p_order_id, 'cancelled', coalesce(v_note, p_reason));
  select * into v_o from public.orders where id = p_order_id;
  insert into public.order_returns (order_id, kind, reason_code, reason_note, status, order_status_before,
                                    order_created_at, order_total, resolved_at, created_by, handled_by)
    values (p_order_id, 'cancellation', p_reason, v_note, 'closed', v_old, v_o.created_at, v_o.total, now(),
            (select auth.uid()), (select auth.uid()))
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.cancel_order(uuid, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, text, text) to authenticated;

-- A return can be registered for shipped or delivered orders. p_received = true when the goods are already
-- back (e.g. the customer refused the parcel): the order moves to "returned" immediately.
create or replace function public.register_return(p_order_id uuid, p_reason text, p_note text default null, p_received boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_note text; v_o public.orders%rowtype; v_id uuid;
begin
  if (select auth.uid()) is null or not public.has_permission('orders.cancel') then raise exception 'forbidden'; end if;
  v_note := public._check_reason(p_reason, p_note);
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_o.status not in ('shipped', 'delivered') then raise exception 'invalid_transition'; end if;
  begin
    insert into public.order_returns (order_id, kind, reason_code, reason_note, status, order_status_before,
                                      order_created_at, order_total, created_by, handled_by, resolved_at)
      values (p_order_id, 'return', p_reason, v_note, case when p_received then 'received' else 'requested' end,
              v_o.status, v_o.created_at, v_o.total, (select auth.uid()), (select auth.uid()),
              case when p_received then now() end)
      returning id into v_id;
  exception when unique_violation then raise exception 'return_already_open';
  end;
  if p_received then perform public._apply_status(p_order_id, 'returned', coalesce(v_note, p_reason)); end if;
  return v_id;
end $$;
revoke all on function public.register_return(uuid, text, text, boolean) from public, anon;
grant execute on function public.register_return(uuid, text, text, boolean) to authenticated;

-- requested -> approved | rejected ; approved -> received (the order becomes "returned").
create or replace function public.update_return(p_return_id uuid, p_status text, p_admin_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_r public.order_returns%rowtype; v_notes text := nullif(btrim(coalesce(p_admin_notes, '')), '');
begin
  if (select auth.uid()) is null or not public.has_permission('orders.cancel') then raise exception 'forbidden'; end if;
  if v_notes is not null and char_length(v_notes) > 1000 then raise exception 'invalid_notes'; end if;
  select * into v_r from public.order_returns where id = p_return_id and kind = 'return' for update;
  if not found then raise exception 'return_not_found'; end if;
  if not ((v_r.status = 'requested' and p_status in ('approved', 'rejected')) or (v_r.status = 'approved' and p_status = 'received')) then
    raise exception 'invalid_transition';
  end if;
  if p_status = 'rejected' and (v_notes is null or char_length(v_notes) < 3) then raise exception 'note_required'; end if;
  if p_status = 'received' then
    perform public._apply_status(v_r.order_id, 'returned', coalesce(v_notes, v_r.reason_code));
  end if;
  update public.order_returns
     set status = p_status, handled_by = (select auth.uid()), admin_notes = coalesce(v_notes, admin_notes),
         resolved_at = case when p_status in ('rejected', 'received') then now() else resolved_at end
   where id = p_return_id;
end $$;
revoke all on function public.update_return(uuid, text, text) from public, anon;
grant execute on function public.update_return(uuid, text, text) to authenticated;

create or replace function public.admin_returns(p_status text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, order_id uuid, order_number bigint, customer_name text, phone text, city text, order_status text,
               kind text, reason_code text, reason_note text, admin_notes text, status text, order_created_at timestamptz,
               requested_at timestamptz, resolved_at timestamptz, order_total numeric, handled_by_name text, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('orders.view') then raise exception 'forbidden'; end if;
  return query
    select r.id, r.order_id, o.order_number, o.customer_name, o.phone, o.city, o.status,
           r.kind, r.reason_code, r.reason_note, r.admin_notes, r.status, r.order_created_at,
           r.requested_at, r.resolved_at, r.order_total,
           coalesce(sp.full_name, left(r.handled_by::text, 8)), count(*) over()
    from public.order_returns r
    join public.orders o on o.id = r.order_id
    left join public.staff_profiles sp on sp.user_id = r.handled_by
    where p_status is null or r.status = p_status
    order by r.requested_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.admin_returns(text, int, int) from public, anon;
grant execute on function public.admin_returns(text, int, int) to authenticated;

-- Returns recorded for one order (order detail page).
create or replace function public.admin_order_returns(p_order_id uuid)
returns table (id uuid, kind text, reason_code text, reason_note text, admin_notes text, status text,
               requested_at timestamptz, resolved_at timestamptz, handled_by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('orders.view') then raise exception 'forbidden'; end if;
  return query
    select r.id, r.kind, r.reason_code, r.reason_note, r.admin_notes, r.status, r.requested_at, r.resolved_at,
           coalesce(sp.full_name, left(r.handled_by::text, 8))
    from public.order_returns r left join public.staff_profiles sp on sp.user_id = r.handled_by
    where r.order_id = p_order_id order by r.requested_at;
end $$;
revoke all on function public.admin_order_returns(uuid) from public, anon;
grant execute on function public.admin_order_returns(uuid) to authenticated;

-- =========================================================
-- 3) Paginated order search (server side: Casablanca day boundaries, no LIKE-pattern injection)
-- =========================================================
create or replace function public.admin_search_orders(
  p_number bigint default null, p_status text default null, p_phone text default null, p_city text default null,
  p_from date default null, p_to date default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, order_number bigint, customer_name text, phone text, city text, status text,
               total numeric, created_at timestamptz, tracking_code text, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_city text := public.city_key(p_city);
begin
  if not public.has_permission('orders.view') then raise exception 'forbidden'; end if;
  v_digits := regexp_replace(regexp_replace(v_digits, '^212', ''), '^0+', '');
  return query
    select o.id, o.order_number, o.customer_name, o.phone, o.city, o.status, o.total, o.created_at, o.tracking_code,
           count(*) over()
    from public.orders o
    where (p_number is null or o.order_number = p_number)
      and (nullif(p_status, '') is null or o.status = p_status)
      and (v_digits = '' or position(v_digits in o.phone) > 0)
      and (v_city = '' or position(v_city in public.city_key(o.city)) > 0)
      and (p_from is null or (o.created_at at time zone 'Africa/Casablanca')::date >= p_from)
      and (p_to is null or (o.created_at at time zone 'Africa/Casablanca')::date <= p_to)
    order by o.created_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.admin_search_orders(bigint, text, text, text, date, date, int, int) from public, anon;
grant execute on function public.admin_search_orders(bigint, text, text, text, date, date, int, int) to authenticated;

-- =========================================================
-- 4) Reports v2. Definitions (shown in the UI too):
--    * Period = order CREATION date, Africa/Casablanca.
--    * Sales ("delivered sales") = orders whose CURRENT status is delivered. Cancelled / returned are never sales.
--    * "revenue" is NOT profit: purchase and operating costs are not recorded anywhere in this system.
-- =========================================================
drop function if exists public.admin_report(date, date);
create or replace function public.admin_report(p_from date, p_to date, p_group text default 'day')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.has_permission('reports.view') then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or coalesce(p_group, 'day') not in ('day', 'week', 'month') then
    raise exception 'invalid_range';
  end if;

  with o as (
    select *, (created_at at time zone 'Africa/Casablanca')::date as d from public.orders
    where (created_at at time zone 'Africa/Casablanca')::date between p_from and p_to
  ), dl as (select * from o where status = 'delivered')
  select jsonb_build_object(
    'orders_total', (select count(*) from o),
    'by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from o group by status) s), '{}'::jsonb),
    'groups', jsonb_build_object(
        'new', (select count(*) from o where status in ('new', 'pending_confirmation')),
        'confirmed', (select count(*) from o where status in ('confirmed', 'preparing', 'shipped')),
        'delivered', (select count(*) from o where status = 'delivered'),
        'cancelled', (select count(*) from o where status = 'cancelled'),
        'returned', (select count(*) from o where status = 'returned')),
    'sales', jsonb_build_object(
        'count', (select count(*) from dl),
        'amount', coalesce((select sum(total) from dl), 0),
        'products_amount', coalesce((select sum(subtotal) from dl), 0),
        'shipping_fees', coalesce((select sum(shipping_fee) from dl), 0),
        'coupon_discounts', coalesce((select sum(coupon_discount) from dl), 0),
        'product_discounts', coalesce((select sum(discount_total) from dl), 0)),
    'shipping', jsonb_build_object(
        'delivered_fees', coalesce((select sum(shipping_fee) from dl), 0),
        'average_fee', coalesce((select round(avg(shipping_fee), 2) from dl), 0),
        'free_shipping_orders', (select count(*) from dl where shipping_fee = 0)),
    'discounts', jsonb_build_object(
        'orders_with_coupon', (select count(*) from dl where coupon_discount > 0),
        'coupon_total', coalesce((select sum(coupon_discount) from dl), 0),
        'product_discount_total', coalesce((select sum(discount_total) from dl), 0)),
    'cancelled', jsonb_build_object('count', (select count(*) from o where status = 'cancelled'),
                                    'amount', coalesce((select sum(total) from o where status = 'cancelled'), 0)),
    'returned', jsonb_build_object('count', (select count(*) from o where status = 'returned'),
                                   'amount', coalesce((select sum(total) from o where status = 'returned'), 0)),
    'delivered_in_period', (
        select jsonb_build_object('count', count(*), 'amount', coalesce(sum(x.total), 0))
        from public.orders x
        where x.status = 'delivered' and exists (
          select 1 from public.order_status_history h
          where h.order_id = x.id and h.to_status = 'delivered'
            and (h.created_at at time zone 'Africa/Casablanca')::date between p_from and p_to)),
    'returns_by_reason', coalesce((
        select jsonb_agg(jsonb_build_object('kind', kind, 'reason', reason_code, 'count', c) order by c desc)
        from (select r.kind, r.reason_code, count(*) c from public.order_returns r
              where (r.requested_at at time zone 'Africa/Casablanca')::date between p_from and p_to
              group by r.kind, r.reason_code) t), '[]'::jsonb),
    'open_returns', (select count(*) from public.order_returns where kind = 'return' and status in ('requested', 'approved')),
    'top_products', coalesce((
        select jsonb_agg(x order by (x->>'quantity')::int desc) from (
          select jsonb_build_object('name_ar', max(i.product_name_ar), 'name_fr', max(i.product_name_fr),
                                    'quantity', sum(i.quantity), 'amount', sum(i.line_total),
                                    'delivered_quantity', coalesce(sum(i.quantity) filter (where o.status = 'delivered'), 0)) x
          from public.order_items i join o on o.id = i.order_id
          where o.status not in ('cancelled', 'returned')
          group by coalesce(i.product_id::text, i.product_name_fr)
          order by sum(i.quantity) desc limit 10) t), '[]'::jsonb),
    'by_city', coalesce((
        select jsonb_agg(x order by (x->>'orders')::int desc) from (
          select jsonb_build_object('city', min(city), 'orders', count(*),
                                    'sales', coalesce(sum(total) filter (where status = 'delivered'), 0)) x
          from o group by public.city_key(city) order by count(*) desc limit 30) t), '[]'::jsonb),
    'by_period', coalesce((
        select jsonb_agg(x order by x->>'period') from (
          select jsonb_build_object('period',
                   case p_group when 'month' then date_trunc('month', d::timestamp)::date when 'week' then date_trunc('week', d::timestamp)::date else d end,
                   'orders', count(*),
                   'sales', coalesce(sum(total) filter (where status = 'delivered'), 0)) x
          from o group by case p_group when 'month' then date_trunc('month', d::timestamp)::date when 'week' then date_trunc('week', d::timestamp)::date else d end) t), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.admin_report(date, date, text) from public, anon;
grant execute on function public.admin_report(date, date, text) to authenticated;

-- Dashboard: "today" now follows the Casablanca calendar day (was the database server's UTC day).
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('orders.view') then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'orders_today', (select count(*) from orders where (created_at at time zone 'Africa/Casablanca')::date = (now() at time zone 'Africa/Casablanca')::date),
    'pending', (select count(*) from orders where status in ('new', 'pending_confirmation')),
    'by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from orders group by status) s), '{}'::jsonb),
    'delivered_revenue', coalesce((select sum(total) from orders where status = 'delivered'), 0),
    'open_returns', (select count(*) from order_returns where kind = 'return' and status in ('requested', 'approved')),
    'published_products', (select count(*) from products where is_published),
    'unavailable_products', (select count(*) from products p where p.is_published and (
        case when exists (select 1 from product_variants v where v.product_id = p.id)
             then not exists (select 1 from product_variants v where v.product_id = p.id and v.is_available)
             else not p.is_available end))
  );
end $$;
revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;

commit;
