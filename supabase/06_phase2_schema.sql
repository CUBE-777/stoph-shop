-- Stoph Shop — Phase 2 / 06: schema migration (additive, keeps all Phase 1 data).
-- Run AFTER 01-04. Then run 07, 08, 09 in order. The whole file is one transaction:
-- if anything fails, nothing is applied and you can fix and re-run.
begin;

-- =========================================================
-- 1) Helpers
-- =========================================================
-- Moroccan phone -> canonical 06XXXXXXXX / 07XXXXXXXX / 05XXXXXXXX, or NULL if invalid.
create or replace function public.normalize_ma_phone(p text)
returns text language sql immutable as $$
  select case when x ~ '^0[5-7][0-9]{8}$' then x end
  from (
    select case when s like '+212%' then '0' || substr(s, 5)
                when s like '00212%' then '0' || substr(s, 6)
                else s end as x
    from (select regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[\s\-\.]', '', 'g') as s) a
  ) b;
$$;

-- Name key used to tell family members sharing one phone apart.
create or replace function public.name_key(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- =========================================================
-- 2) Permissions (fine-grained RBAC). Renames keep existing role assignments.
-- =========================================================
update public.permissions set key = 'staff.manage',        description = 'Manage staff accounts and their roles' where key = 'roles.manage';
update public.permissions set key = 'orders.update_status', description = 'Move orders through the normal workflow'  where key = 'orders.manage';
update public.permissions set key = 'products.update',      description = 'Edit products, variants and images'        where key = 'products.manage';

insert into public.permissions (key, description) values
  ('products.view',   'See all products, including hidden ones'),
  ('products.create', 'Create products'),
  ('products.delete', 'Delete products'),
  ('orders.cancel',   'Cancel orders and register returns'),
  ('customers.view',  'See the customers section and order history per customer'),
  ('customers.update','Edit customer name and internal notes'),
  ('coupons.manage',  'Manage coupons'),
  ('reports.view',    'See reports')
on conflict (key) do nothing;

-- The owner always holds every permission.
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r cross join public.permissions p where r.key = 'owner'
on conflict do nothing;

-- Manager defaults.
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p
    on p.key in ('products.view','products.create','products.update','categories.manage','orders.view',
                 'orders.update_status','orders.cancel','customers.view','customers.update','shipping.manage',
                 'coupons.manage','reports.view')
  where r.key = 'manager'
on conflict do nothing;

-- Example limited role: can follow and confirm orders, cannot cancel, ship money rules or see reports.
insert into public.roles (key, name) values ('support', 'Support') on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p
    on p.key in ('products.view','orders.view','orders.update_status','customers.view')
  where r.key = 'support'
on conflict do nothing;

-- =========================================================
-- 3) Customers: one record per (phone + name) so a family sharing a phone is not merged
-- =========================================================
alter table public.customers drop constraint if exists customers_phone_key;
alter table public.customers add column if not exists name_key text generated always as (public.name_key(full_name)) stored;
alter table public.customers add column if not exists staff_notes text;
alter table public.customers add column if not exists last_city text;
alter table public.customers add column if not exists last_address text;
create unique index if not exists customers_phone_name_uq on public.customers (phone, name_key);
create index if not exists customers_phone_idx on public.customers (phone);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customers_phone_format') then
    alter table public.customers add constraint customers_phone_format check (phone ~ '^0[5-7][0-9]{8}$');
  end if;
end $$;

-- =========================================================
-- 4) Products: optional time window for the sale price
-- =========================================================
alter table public.products add column if not exists sale_starts_at timestamptz;
alter table public.products add column if not exists sale_ends_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_sale_window') then
    alter table public.products add constraint products_sale_window
      check (sale_starts_at is null or sale_ends_at is null or sale_ends_at > sale_starts_at);
  end if;
end $$;

-- =========================================================
-- 5) Coupons
-- =========================================================
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  description text,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  value numeric(10,2) not null check (value > 0),
  max_discount numeric(10,2) check (max_discount is null or max_discount > 0),  -- cap for percent coupons
  min_order numeric(10,2) not null default 0 check (min_order >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses int check (max_uses is null or max_uses > 0),
  used_count int not null default 0 check (used_count >= 0),
  one_per_phone boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percent' or value <= 100),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

-- =========================================================
-- 6) Orders: new statuses, tracking code, coupon snapshot
-- =========================================================
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.orders'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%pending_confirmation%'
  loop execute format('alter table public.orders drop constraint %I', c.conname); end loop;
end $$;
alter table public.orders add constraint orders_status_check check (status in
  ('new','pending_confirmation','confirmed','preparing','shipped','delivered','cancelled','returned'));

alter table public.orders add column if not exists tracking_code text;
update public.orders set tracking_code = 'SS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  where tracking_code is null;
alter table public.orders alter column tracking_code set not null;
alter table public.orders alter column tracking_code
  set default ('SS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));
create unique index if not exists orders_tracking_code_uq on public.orders (tracking_code);
create index if not exists orders_phone_idx on public.orders (phone);
create index if not exists orders_city_idx on public.orders (lower(city));
create index if not exists orders_customer_idx on public.orders (customer_id);

alter table public.orders add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists coupon_discount numeric(10,2) not null default 0 check (coupon_discount >= 0);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  phone text not null,
  amount numeric(10,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_idx on public.coupon_redemptions (coupon_id, phone);

-- =========================================================
-- 7) Order status history + allowed transitions (data-driven, reviewable)
-- =========================================================
create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid,                      -- staff user; NULL = created by the customer
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history (order_id, created_at);

-- One-time backfill for orders that existed before Phase 2 (time = order creation; approximate).
insert into public.order_status_history (order_id, from_status, to_status, note, created_at)
  select o.id, null, o.status, 'backfill (phase 2 migration)', o.created_at
  from public.orders o
  where not exists (select 1 from public.order_status_history h where h.order_id = o.id);

create table if not exists public.order_transitions (
  from_status text not null,
  to_status text not null,
  required_permission text not null,
  primary key (from_status, to_status)
);
insert into public.order_transitions values
  ('new','pending_confirmation','orders.update_status'),
  ('new','confirmed','orders.update_status'),
  ('new','cancelled','orders.cancel'),
  ('pending_confirmation','confirmed','orders.update_status'),
  ('pending_confirmation','cancelled','orders.cancel'),
  ('confirmed','preparing','orders.update_status'),
  ('confirmed','shipped','orders.update_status'),
  ('confirmed','cancelled','orders.cancel'),
  ('preparing','shipped','orders.update_status'),
  ('preparing','cancelled','orders.cancel'),
  ('shipped','delivered','orders.update_status'),
  ('shipped','returned','orders.cancel'),
  ('delivered','returned','orders.cancel')
on conflict do nothing;

-- =========================================================
-- 8) Rate-limit events (used by order tracking, coupon guessing, order spam)
-- =========================================================
create table if not exists public.rate_events (
  id bigint generated always as identity primary key,
  kind text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_idx on public.rate_events (kind, key, created_at desc);

-- =========================================================
-- 9) Audit: immutable log + more triggers
-- =========================================================
create or replace function public.audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only'; end $$;
drop trigger if exists audit_logs_no_change on public.audit_logs;
create trigger audit_logs_no_change before update or delete on public.audit_logs
  for each row execute function public.audit_immutable();

drop trigger if exists audit_coupons on public.coupons;
create trigger audit_coupons after insert or update or delete on public.coupons for each row execute function public.log_change();
drop trigger if exists audit_staff_profiles on public.staff_profiles;
create trigger audit_staff_profiles after insert or update or delete on public.staff_profiles for each row execute function public.log_change();
drop trigger if exists audit_staff_assignments on public.staff_role_assignments;
create trigger audit_staff_assignments after insert or update or delete on public.staff_role_assignments for each row execute function public.log_change();
drop trigger if exists audit_role_permissions on public.role_permissions;
create trigger audit_role_permissions after insert or update or delete on public.role_permissions for each row execute function public.log_change();
drop trigger if exists audit_roles on public.roles;
create trigger audit_roles after insert or update or delete on public.roles for each row execute function public.log_change();
drop trigger if exists audit_customers on public.customers;
create trigger audit_customers after update or delete on public.customers for each row execute function public.log_change();

commit;
