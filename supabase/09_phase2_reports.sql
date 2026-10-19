-- Stoph Shop — Phase 2 / 09: reports + new-order notification feed. Run after 08.
begin;

-- Report rules (documented so the numbers are never ambiguous):
--  * The period filters on the order CREATION date (Africa/Casablanca time).
--  * "Sales" = total of orders whose CURRENT status is delivered. Cancelled and returned are reported separately.
--  * "Top products" counts quantities from orders that are not cancelled/returned.
create or replace function public.admin_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.has_permission('reports.view') then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'invalid_range'; end if;

  with o as (
    select * from public.orders
    where (created_at at time zone 'Africa/Casablanca')::date between p_from and p_to
  )
  select jsonb_build_object(
    'orders_total', (select count(*) from o),
    'by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from o group by status) s), '{}'::jsonb),
    'sales', jsonb_build_object(
        'count', (select count(*) from o where status = 'delivered'),
        'amount', coalesce((select sum(total) from o where status = 'delivered'), 0)),
    'cancelled', jsonb_build_object(
        'count', (select count(*) from o where status = 'cancelled'),
        'amount', coalesce((select sum(total) from o where status = 'cancelled'), 0)),
    'returned', jsonb_build_object(
        'count', (select count(*) from o where status = 'returned'),
        'amount', coalesce((select sum(total) from o where status = 'returned'), 0)),
    'top_products', coalesce((
        select jsonb_agg(x order by (x->>'quantity')::int desc) from (
          select jsonb_build_object('name_ar', max(i.product_name_ar), 'name_fr', max(i.product_name_fr),
                                    'quantity', sum(i.quantity), 'amount', sum(i.line_total)) x
          from public.order_items i join o on o.id = i.order_id
          where o.status not in ('cancelled', 'returned')
          group by coalesce(i.product_id::text, i.product_name_fr)
          order by sum(i.quantity) desc limit 10) t), '[]'::jsonb),
    'by_city', coalesce((
        select jsonb_agg(x order by (x->>'orders')::int desc) from (
          select jsonb_build_object('city', min(city), 'orders', count(*),
                                    'sales', coalesce(sum(total) filter (where status = 'delivered'), 0)) x
          from o group by lower(btrim(city)) order by count(*) desc limit 30) t), '[]'::jsonb),
    'by_day', coalesce((
        select jsonb_agg(x order by x->>'day') from (
          select jsonb_build_object('day', (created_at at time zone 'Africa/Casablanca')::date,
                                    'orders', count(*),
                                    'sales', coalesce(sum(total) filter (where status = 'delivered'), 0)) x
          from o group by (created_at at time zone 'Africa/Casablanca')::date) t), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.admin_report(date, date) from public, anon;
grant execute on function public.admin_report(date, date) to authenticated;

-- Notification feed polled by the admin panel: orders created after p_since.
create or replace function public.admin_new_orders(p_since timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('orders.view') then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'now', now(),
    'count', (select count(*) from public.orders where created_at > p_since),
    'awaiting', (select count(*) from public.orders where status in ('new', 'pending_confirmation')),
    'latest', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'order_number', order_number, 'city', city, 'total', total) order by created_at desc)
                        from (select * from public.orders where created_at > p_since order by created_at desc limit 5) t), '[]'::jsonb));
end $$;
revoke all on function public.admin_new_orders(timestamptz) from public, anon;
grant execute on function public.admin_new_orders(timestamptz) to authenticated;

commit;
