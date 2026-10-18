-- Stoph Shop — 02 Row Level Security + storage. Run after 01.

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_role_assignments enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.shipping_rates enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.audit_logs enable row level security;

-- Visitors (anon) never touch sensitive tables directly.
revoke all on public.customers, public.orders, public.order_items, public.audit_logs,
  public.staff_profiles, public.staff_role_assignments, public.roles,
  public.permissions, public.role_permissions from anon;
-- Only SELECT is ever needed on catalog tables for visitors; writes are RLS-gated for staff.
revoke insert, update, delete on public.categories, public.products, public.product_images,
  public.product_variants, public.shipping_rates from anon;

-- ===== Catalog: public read of published data =====
create policy categories_public_read on public.categories for select to anon, authenticated
  using (is_active);
create policy categories_staff_all on public.categories for all to authenticated
  using (public.has_permission('categories.manage')) with check (public.has_permission('categories.manage'));

create policy products_public_read on public.products for select to anon, authenticated
  using (is_published);
create policy products_staff_all on public.products for all to authenticated
  using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy images_public_read on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.is_published));
create policy images_staff_all on public.product_images for all to authenticated
  using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy variants_public_read on public.product_variants for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.is_published));
create policy variants_staff_all on public.product_variants for all to authenticated
  using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

-- ===== Shipping =====
create policy shipping_public_read on public.shipping_rates for select to anon, authenticated
  using (is_active);
create policy shipping_staff_all on public.shipping_rates for all to authenticated
  using (public.has_permission('shipping.manage')) with check (public.has_permission('shipping.manage'));

-- ===== Orders / customers: staff read-only. Writes happen ONLY through
-- create_order() and set_order_status() (security definer functions). =====
create policy customers_staff_read on public.customers for select to authenticated
  using (public.has_permission('orders.view'));
create policy orders_staff_read on public.orders for select to authenticated
  using (public.has_permission('orders.view'));
create policy order_items_staff_read on public.order_items for select to authenticated
  using (public.has_permission('orders.view'));

-- ===== Staff / roles: read-only from the app; changes are made by the owner via SQL (phase 2 adds UI) =====
create policy staff_self_read on public.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('roles.manage'));
create policy assignments_read on public.staff_role_assignments for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('roles.manage'));
create policy roles_read on public.roles for select to authenticated using (public.has_permission('roles.manage'));
create policy permissions_read on public.permissions for select to authenticated using (public.has_permission('roles.manage'));
create policy role_permissions_read on public.role_permissions for select to authenticated using (public.has_permission('roles.manage'));

create policy audit_read on public.audit_logs for select to authenticated
  using (public.has_permission('audit.view'));

-- ===== Storage: public bucket for product images =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Public bucket => files are readable by URL. Only authorized staff may write.
create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.has_permission('products.manage'));
create policy product_images_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_permission('products.manage'));
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_permission('products.manage'));
