-- Stoph Shop — 01 schema. Run first, in the Supabase SQL Editor.
-- No demo data here (demo data lives in 05_seed_demo_optional.sql).

-- ========== Roles & permissions (extensible in phase 2) ==========
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null
);
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text
);
create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.staff_role_assignments (
  user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id)
);

insert into public.permissions (key, description) values
  ('products.manage','Create/edit/hide products, variants and images'),
  ('categories.manage','Manage categories'),
  ('orders.view','View orders and customers'),
  ('orders.manage','Change order status'),
  ('shipping.manage','Manage shipping rates'),
  ('settings.manage','Manage store settings'),
  ('roles.manage','Manage staff and roles'),
  ('audit.view','View audit log');
insert into public.roles (key, name) values ('owner','Owner'), ('manager','Manager');
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r cross join public.permissions p where r.key = 'owner';
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p
    on p.key in ('products.manage','categories.manage','orders.view','orders.manage','shipping.manage')
  where r.key = 'manager';

create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from staff_profiles sp
    join staff_role_assignments a on a.user_id = sp.user_id
    join role_permissions rp on rp.role_id = a.role_id
    join permissions pm on pm.id = rp.permission_id
    where sp.user_id = (select auth.uid()) and sp.is_active and pm.key = p_key
  );
$$;

create or replace function public.my_permissions()
returns setof text language sql stable security definer set search_path = public as $$
  select pm.key
  from staff_profiles sp
  join staff_role_assignments a on a.user_id = sp.user_id
  join role_permissions rp on rp.role_id = a.role_id
  join permissions pm on pm.id = rp.permission_id
  where sp.user_id = (select auth.uid()) and sp.is_active;
$$;

-- ========== Catalog ==========
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text not null check (char_length(name_ar) between 1 and 100),
  name_fr text not null check (char_length(name_fr) between 1 and 100),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text not null check (char_length(name_ar) between 1 and 200),
  name_fr text not null check (char_length(name_fr) between 1 and 200),
  description_ar text not null default '',
  description_fr text not null default '',
  price numeric(10,2) not null check (price >= 0),
  sale_price numeric(10,2) check (sale_price is null or (sale_price >= 0 and sale_price < price)),
  is_published boolean not null default false,
  is_featured boolean not null default false,
  -- availability of a SIMPLE product (no variants). Ignored when variants exist.
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);
create index products_listing_idx on public.products (is_published, is_featured, created_at desc);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  path text not null,               -- path inside the "product-images" bucket
  alt text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label_ar text not null check (char_length(label_ar) between 1 and 100),
  label_fr text not null check (char_length(label_fr) between 1 and 100),
  color text, size text, capacity text,
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index product_variants_product_idx on public.product_variants (product_id, sort_order);

-- ========== Shipping ==========
create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  city text,
  fee numeric(10,2) not null check (fee >= 0),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((is_default and city is null) or (not is_default and city is not null))
);
create unique index shipping_rates_city_uq on public.shipping_rates (lower(city)) where not is_default;
create unique index shipping_rates_default_uq on public.shipping_rates (is_default) where is_default;
-- PLACEHOLDER default fee. Change it from /admin/shipping before going live.
insert into public.shipping_rates (city, fee, is_default) values (null, 40, true);

-- ========== Customers & orders ==========
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity (start with 1001) unique,
  customer_id uuid references public.customers(id) on delete set null,
  -- immutable customer snapshot
  customer_name text not null,
  phone text not null,
  city text not null,
  address text not null,
  notes text,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation','confirmed','shipped','delivered','cancelled','returned')),
  payment_method text not null default 'cod' check (payment_method = 'cod'),
  subtotal numeric(10,2) not null check (subtotal >= 0),
  discount_total numeric(10,2) not null default 0 check (discount_total >= 0),
  shipping_fee numeric(10,2) not null check (shipping_fee >= 0),
  total numeric(10,2) not null check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  -- immutable snapshot: never changes when the product is edited later
  product_name_ar text not null,
  product_name_fr text not null,
  variant_label_ar text,
  variant_label_fr text,
  unit_price numeric(10,2) not null check (unit_price >= 0),          -- original price
  discount_per_unit numeric(10,2) not null default 0 check (discount_per_unit >= 0),
  unit_final_price numeric(10,2) not null check (unit_final_price >= 0),
  quantity int not null check (quantity between 1 and 20),
  line_total numeric(10,2) not null check (line_total >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ========== Triggers ==========
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values ((select auth.uid()), tg_op, tg_table_name, r->>'id', r);
  return null;
end $$;
create trigger audit_products after insert or update or delete on public.products for each row execute function public.log_change();
create trigger audit_categories after insert or update or delete on public.categories for each row execute function public.log_change();
create trigger audit_variants after insert or update or delete on public.product_variants for each row execute function public.log_change();
create trigger audit_shipping after insert or update or delete on public.shipping_rates for each row execute function public.log_change();
