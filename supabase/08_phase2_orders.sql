-- Stoph Shop — Phase 2 / 08: server-side pricing, coupons, orders, tracking, status workflow. Run after 07.
-- Replaces create_order (adds an optional coupon argument) and set_order_status (adds notes, history, roles).
begin;

drop function if exists public.create_order(jsonb, jsonb);
drop function if exists public.set_order_status(uuid, text);

-- ---------------------------------------------------------
-- Rate limiting helpers (best effort per IP + strict per phone / code)
-- ---------------------------------------------------------
create or replace function public._client_ip() returns text
language plpgsql stable as $$
declare h json; xff text;
begin
  h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  xff := h->>'x-forwarded-for';
  return coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(h->>'x-real-ip', ''),
                  nullif(btrim((string_to_array(coalesce(xff, ''), ','))[cardinality(string_to_array(coalesce(xff, ''), ','))]), ''));
exception when others then return null;
end $$;

create or replace function public._rate_count(p_kind text, p_key text, p_window interval) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from rate_events where kind = p_kind and key = p_key and created_at > now() - p_window;
$$;

create or replace function public._rate_log(p_kind text, p_keys text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into rate_events (kind, key) select p_kind, k from unnest(p_keys) k where k is not null;
  if random() < 0.02 then delete from rate_events where created_at < now() - interval '2 days'; end if;
end $$;
revoke all on function public._client_ip(), public._rate_count(text, text, interval), public._rate_log(text, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------
-- _price_order: the ONE place where prices, availability, sale windows, coupon and shipping are decided.
-- ---------------------------------------------------------
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
    where is_active and not is_default and lower(city) = lower(v_city) limit 1;
  if v_fee is null then select fee into v_fee from public.shipping_rates where is_active and is_default limit 1; end if;
  if v_fee is null then raise exception 'shipping_unavailable'; end if;

  return jsonb_build_object('lines', v_lines, 'subtotal', v_subtotal, 'product_discount', v_pdisc,
    'coupon_id', v_cp.id, 'coupon_code', v_cp.code, 'coupon_discount', v_cdisc,
    'shipping_fee', v_fee, 'total', v_subtotal - v_cdisc + v_fee);
end $$;
revoke all on function public._price_order(jsonb, text, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------
-- quote_order: what the checkout page shows (no write). Coupon failures are rate limited.
-- ---------------------------------------------------------
create or replace function public.quote_order(p_items jsonb, p_city text default null, p_coupon text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_ip text := public._client_ip(); v_phone text := public.normalize_ma_phone(p_phone);
begin
  if nullif(btrim(coalesce(p_coupon, '')), '') is not null then
    if public._rate_count('coupon_fail', 'ip:' || coalesce(v_ip, '-'), interval '15 minutes') >= 15 and v_ip is not null then
      raise exception 'rate_limited'; end if;
  end if;
  begin
    v := public._price_order(p_items, p_city, p_coupon, v_phone, false);
  exception when others then
    if sqlerrm in ('coupon_invalid', 'coupon_min_order') then
      perform public._rate_log('coupon_fail', array['ip:' || v_ip]);   -- persists: we return normally
      return jsonb_build_object('error', sqlerrm);
    end if;
    raise;
  end;
  return v - 'lines' - 'coupon_id';
end $$;
revoke all on function public.quote_order(jsonb, text, text, text) from public;
grant execute on function public.quote_order(jsonb, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- create_order: validate -> price on server -> write everything atomically
-- Coupon problems are returned as {"error": "..."} (not raised) so the failed attempt can be rate limited.
-- ---------------------------------------------------------
create or replace function public.create_order(p_customer jsonb, p_items jsonb, p_coupon text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name    text := btrim(coalesce(p_customer->>'full_name', ''));
  v_phone   text := public.normalize_ma_phone(p_customer->>'phone');
  v_city    text := btrim(coalesce(p_customer->>'city', ''));
  v_address text := btrim(coalesce(p_customer->>'address', ''));
  v_notes   text := nullif(btrim(coalesce(p_customer->>'notes', '')), '');
  v_ip text := public._client_ip();
  v_price jsonb; v_customer_id uuid; v_order_id uuid; v_number bigint; v_tracking text;
  v_cdisc numeric(10,2);
begin
  if char_length(v_name) < 2 or char_length(v_name) > 100 then raise exception 'invalid_name'; end if;
  if v_phone is null then raise exception 'invalid_phone'; end if;
  if char_length(v_city) < 2 or char_length(v_city) > 60 then raise exception 'invalid_city'; end if;
  if char_length(v_address) < 5 or char_length(v_address) > 300 then raise exception 'invalid_address'; end if;
  if v_notes is not null and char_length(v_notes) > 500 then raise exception 'invalid_notes'; end if;

  -- anti-spam: few orders per phone / per IP per hour
  if public._rate_count('order', 'phone:' || v_phone, interval '1 hour') >= 5
     or (v_ip is not null and public._rate_count('order', 'ip:' || v_ip, interval '1 hour') >= 20) then
    raise exception 'rate_limited';
  end if;
  if nullif(btrim(coalesce(p_coupon, '')), '') is not null and v_ip is not null
     and public._rate_count('coupon_fail', 'ip:' || v_ip, interval '15 minutes') >= 15 then
    raise exception 'rate_limited';
  end if;

  begin
    v_price := public._price_order(p_items, v_city, p_coupon, v_phone, true);
  exception when others then
    if sqlerrm in ('coupon_invalid', 'coupon_min_order') then
      perform public._rate_log('coupon_fail', array['ip:' || v_ip]);
      return jsonb_build_object('error', sqlerrm);
    end if;
    raise;
  end;
  v_cdisc := (v_price->>'coupon_discount')::numeric;

  -- customer: same phone + same name = same record; same phone + other name = family member
  select id into v_customer_id from public.customers where phone = v_phone and name_key = public.name_key(v_name);
  if v_customer_id is null then
    begin
      insert into public.customers (full_name, phone, last_city, last_address) values (v_name, v_phone, v_city, v_address)
        returning id into v_customer_id;
    exception when unique_violation then
      select id into v_customer_id from public.customers where phone = v_phone and name_key = public.name_key(v_name);
    end;
  end if;
  update public.customers set last_city = v_city, last_address = v_address where id = v_customer_id;

  insert into public.orders (customer_id, customer_name, phone, city, address, notes,
                             subtotal, discount_total, shipping_fee, total, coupon_id, coupon_code, coupon_discount)
    values (v_customer_id, v_name, v_phone, v_city, v_address, v_notes,
            (v_price->>'subtotal')::numeric, (v_price->>'product_discount')::numeric, (v_price->>'shipping_fee')::numeric,
            (v_price->>'total')::numeric, nullif(v_price->>'coupon_id', '')::uuid, v_price->>'coupon_code', v_cdisc)
    returning id, order_number, tracking_code into v_order_id, v_number, v_tracking;

  insert into public.order_items (order_id, product_id, variant_id, product_name_ar, product_name_fr,
      variant_label_ar, variant_label_fr, unit_price, discount_per_unit, unit_final_price, quantity, line_total)
    select v_order_id, (l->>'product_id')::uuid, nullif(l->>'variant_id', '')::uuid,
           l->>'name_ar', l->>'name_fr', l->>'label_ar', l->>'label_fr',
           (l->>'unit_price')::numeric, (l->>'discount')::numeric, (l->>'final')::numeric,
           (l->>'qty')::int, (l->>'line_total')::numeric
    from jsonb_array_elements(v_price->'lines') l;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by) values (v_order_id, null, 'pending_confirmation', null);

  if (v_price->>'coupon_id') is not null then
    update public.coupons set used_count = used_count + 1 where id = (v_price->>'coupon_id')::uuid;
    insert into public.coupon_redemptions (coupon_id, order_id, phone, amount)
      values ((v_price->>'coupon_id')::uuid, v_order_id, v_phone, v_cdisc);
  end if;

  perform public._rate_log('order', array['phone:' || v_phone, 'ip:' || v_ip]);

  return jsonb_build_object('order_number', v_number, 'tracking_code', v_tracking,
    'subtotal', (v_price->>'subtotal')::numeric, 'discount_total', (v_price->>'product_discount')::numeric,
    'coupon_discount', v_cdisc, 'shipping_fee', (v_price->>'shipping_fee')::numeric, 'total', (v_price->>'total')::numeric);
end $$;
revoke all on function public.create_order(jsonb, jsonb, text) from public;
grant execute on function public.create_order(jsonb, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------
-- track_order: public tracking by (tracking code + phone). Returns only what is needed to follow the order.
-- Wrong guesses are logged (and the function returns normally so the log is kept), then rate limited.
-- ---------------------------------------------------------
create or replace function public.track_order(p_code text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_phone text := public.normalize_ma_phone(p_phone);
  v_ip text := public._client_ip();
  v_o public.orders%rowtype;
begin
  if (v_ip is not null and public._rate_count('track_fail', 'ip:' || v_ip, interval '15 minutes') >= 10)
     or public._rate_count('track_fail', 'code:' || left(v_code, 20), interval '15 minutes') >= 8
     or (v_phone is not null and public._rate_count('track_fail', 'phone:' || v_phone, interval '15 minutes') >= 8) then
    raise exception 'rate_limited';
  end if;

  if v_code ~ '^SS-[0-9A-F]{10}$' and v_phone is not null then
    select * into v_o from public.orders where tracking_code = v_code and phone = v_phone;
  end if;

  if v_o.id is null then
    perform public._rate_log('track_fail', array['ip:' || v_ip, 'code:' || left(v_code, 20), 'phone:' || v_phone]);
    return jsonb_build_object('found', false);   -- same answer for wrong code, wrong phone or invalid format
  end if;

  return jsonb_build_object(
    'found', true, 'tracking_code', v_o.tracking_code, 'status', v_o.status,
    'created_at', v_o.created_at, 'total', v_o.total,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name_ar', i.product_name_ar, 'name_fr', i.product_name_fr,
              'variant_ar', i.variant_label_ar, 'variant_fr', i.variant_label_fr, 'quantity', i.quantity))
              from public.order_items i where i.order_id = v_o.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.created_at) order by h.created_at, h.id)
              from public.order_status_history h where h.order_id = v_o.id), '[]'::jsonb));
end $$;
revoke all on function public.track_order(text, text) from public;
grant execute on function public.track_order(text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- set_order_status: transition must exist in order_transitions AND the staff member must hold the
-- permission that transition requires. Writes history + audit.
-- ---------------------------------------------------------
create or replace function public.set_order_status(p_order_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_perm text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if (select auth.uid()) is null then raise exception 'forbidden'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid_notes'; end if;
  select status into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select required_permission into v_perm from public.order_transitions where from_status = v_old and to_status = p_status;
  if v_perm is null then raise exception 'invalid_transition'; end if;
  if not public.has_permission(v_perm) then raise exception 'forbidden'; end if;
  update public.orders set status = p_status where id = p_order_id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_old, p_status, (select auth.uid()), v_note);
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values ((select auth.uid()), 'STATUS', 'orders', p_order_id::text,
            jsonb_build_object('from', v_old, 'to', p_status, 'note', v_note));
end $$;
revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

commit;
