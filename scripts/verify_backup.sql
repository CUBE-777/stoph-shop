-- Run in the SQL Editor of the RESTORED (test) project, then compare with the numbers you noted on the source project.
-- Read-only. Safe to run anywhere.
select 'orders' as t, count(*) n, coalesce(sum(total),0) as amount from public.orders
union all select 'orders delivered', count(*), coalesce(sum(total),0) from public.orders where status = 'delivered'
union all select 'order_items', count(*), coalesce(sum(line_total),0) from public.order_items
union all select 'customers', count(*), 0 from public.customers
union all select 'products', count(*), 0 from public.products
union all select 'product_images', count(*), 0 from public.product_images
union all select 'coupons', count(*), 0 from public.coupons
union all select 'order_returns', count(*), coalesce(sum(order_total),0) from public.order_returns
union all select 'audit_logs', count(*), 0 from public.audit_logs
union all select 'staff_profiles', count(*), 0 from public.staff_profiles;

-- Integrity: every list below must be EMPTY.
select 'order without items' as problem, o.id::text from public.orders o where not exists (select 1 from public.order_items i where i.order_id = o.id)
union all select 'order total mismatch', o.id::text from public.orders o where o.total <> o.subtotal - o.coupon_discount + o.shipping_fee
union all select 'item line mismatch', i.id::text from public.order_items i where i.line_total <> i.unit_final_price * i.quantity
union all select 'order without history', o.id::text from public.orders o where not exists (select 1 from public.order_status_history h where h.order_id = o.id)
union all select 'duplicate tracking code', tracking_code from public.orders group by tracking_code having count(*) > 1
union all select 'image row without product', p.id::text from public.product_images p where not exists (select 1 from public.products x where x.id = p.product_id)
union all select 'return without order', r.id::text from public.order_returns r where not exists (select 1 from public.orders o where o.id = r.order_id);

-- Security objects must have survived the restore.
select 'table without RLS' as problem, c.relname::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;                    -- must be empty
select count(*) as policies_in_public from pg_policies where schemaname = 'public';        -- compare with the source project
select count(*) as functions_in_public from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
select value as mfa_enforced from public.app_settings where key = 'mfa_enforced';
