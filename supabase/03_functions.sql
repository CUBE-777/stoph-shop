-- Stoph Shop — 03 server-side functions. Run after 02.

-- ============================================================
-- create_order: the ONLY way a visitor creates an order.
-- Validates input, re-checks availability, computes every price and the
-- shipping fee on the server, and writes everything in one transaction
-- (a PL/pgSQL function is atomic: any error rolls back the whole order).
-- Errors are raised as short codes the UI translates (invalid_phone, ...).
-- ============================================================
create or replace function public.create_order(p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name    text := btrim(coalesce(p_customer->>'full_name', ''));
  v_phone   text := regexp_replace(coalesce(p_customer->>'phone', ''), '[\s\-\.]', '', 'g');
  v_city    text := btrim(coalesce(p_customer->>'city', ''));
  v_address text := btrim(coalesce(p_customer->>'address', ''));
  v_notes   text := nullif(btrim(coalesce(p_customer->>'notes', '')), '');
  v_item jsonb;
  v_prod public.products%rowtype;
  v_var  public.product_variants%rowtype;
  v_qty int;
  v_unit numeric(10,2);
  v_orig numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2) := 0;
  v_fee numeric(10,2);
  v_customer_id uuid;
  v_order_id uuid;
  v_number bigint;
  v_lines jsonb := '[]'::jsonb;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- ---- customer validation ----
  if char_length(v_name) < 2 or char_length(v_name) > 100 then raise exception 'invalid_name'; end if;
  if v_phone like '+212%' then v_phone := '0' || substr(v_phone, 5);
  elsif v_phone like '00212%' then v_phone := '0' || substr(v_phone, 6); end if;
  if v_phone !~ '^0[5-7][0-9]{8}$' then raise exception 'invalid_phone'; end if;
  if char_length(v_city) < 2 or char_length(v_city) > 60 then raise exception 'invalid_city'; end if;
  if char_length(v_address) < 5 or char_length(v_address) > 300 then raise exception 'invalid_address'; end if;
  if v_notes is not null and char_length(v_notes) > 500 then raise exception 'invalid_notes'; end if;

  -- ---- items validation ----
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

    select * into v_prod from public.products
      where id = (v_item->>'product_id')::uuid and is_published for share;
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
    v_unit := coalesce(v_prod.sale_price, v_prod.price);
    v_subtotal := v_subtotal + v_unit * v_qty;
    v_discount := v_discount + (v_orig - v_unit) * v_qty;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_prod.id, 'variant_id', v_var.id,
      'name_ar', v_prod.name_ar, 'name_fr', v_prod.name_fr,
      'label_ar', v_var.label_ar, 'label_fr', v_var.label_fr,
      'unit_price', v_orig, 'discount', v_orig - v_unit, 'final', v_unit,
      'qty', v_qty, 'line_total', v_unit * v_qty);
  end loop;

  -- ---- shipping fee: city rate, else default ----
  select fee into v_fee from public.shipping_rates
    where is_active and not is_default and lower(city) = lower(v_city) limit 1;
  if v_fee is null then
    select fee into v_fee from public.shipping_rates where is_active and is_default limit 1;
  end if;
  if v_fee is null then raise exception 'shipping_unavailable'; end if;

  -- ---- write ----
  insert into public.customers (full_name, phone) values (v_name, v_phone)
    on conflict (phone) do update set full_name = excluded.full_name
    returning id into v_customer_id;

  insert into public.orders (customer_id, customer_name, phone, city, address, notes,
                             subtotal, discount_total, shipping_fee, total)
    values (v_customer_id, v_name, v_phone, v_city, v_address, v_notes,
            v_subtotal, v_discount, v_fee, v_subtotal + v_fee)
    returning id, order_number into v_order_id, v_number;

  insert into public.order_items (order_id, product_id, variant_id, product_name_ar, product_name_fr,
      variant_label_ar, variant_label_fr, unit_price, discount_per_unit, unit_final_price, quantity, line_total)
    select v_order_id, (l->>'product_id')::uuid, nullif(l->>'variant_id','')::uuid,
           l->>'name_ar', l->>'name_fr', l->>'label_ar', l->>'label_fr',
           (l->>'unit_price')::numeric, (l->>'discount')::numeric, (l->>'final')::numeric,
           (l->>'qty')::int, (l->>'line_total')::numeric
    from jsonb_array_elements(v_lines) l;

  return jsonb_build_object('order_number', v_number, 'subtotal', v_subtotal,
    'discount_total', v_discount, 'shipping_fee', v_fee, 'total', v_subtotal + v_fee);
end $$;

revoke all on function public.create_order(jsonb, jsonb) from public;
grant execute on function public.create_order(jsonb, jsonb) to anon, authenticated;

-- ============================================================
-- set_order_status: staff only, restricted transitions, audited.
-- ============================================================
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.has_permission('orders.manage') then raise exception 'forbidden'; end if;
  select status into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if not (
       (v_old = 'pending_confirmation' and p_status in ('confirmed','cancelled'))
    or (v_old = 'confirmed' and p_status in ('shipped','cancelled'))
    or (v_old = 'shipped'   and p_status in ('delivered','returned'))
    or (v_old = 'delivered' and p_status = 'returned')
  ) then raise exception 'invalid_transition'; end if;
  update public.orders set status = p_status where id = p_order_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
    values ((select auth.uid()), 'STATUS', 'orders', p_order_id::text,
            jsonb_build_object('from', v_old, 'to', p_status));
end $$;
revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;

-- ============================================================
-- admin_dashboard: basic indicators (requires orders.view).
-- ============================================================
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('orders.view') then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'orders_today', (select count(*) from orders where created_at >= date_trunc('day', now())),
    'pending', (select count(*) from orders where status = 'pending_confirmation'),
    'by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from orders group by status) s), '{}'::jsonb),
    'delivered_revenue', coalesce((select sum(total) from orders where status = 'delivered'), 0),
    'published_products', (select count(*) from products where is_published),
    'unavailable_products', (select count(*) from products p where p.is_published and (
        case when exists (select 1 from product_variants v where v.product_id = p.id)
             then not exists (select 1 from product_variants v where v.product_id = p.id and v.is_available)
             else not p.is_available end))
  );
end $$;
revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;

grant execute on function public.my_permissions() to authenticated;
revoke execute on function public.my_permissions() from anon;
