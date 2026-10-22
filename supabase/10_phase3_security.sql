-- Stoph Shop — Phase 3 / 10: MFA enforcement, storage hardening, policy performance, indexes.
-- Run AFTER 09. One transaction: on any error nothing is applied. NOT executed in the build environment
-- (no PostgreSQL there) — run it first on a development project / after a backup.
begin;

-- =========================================================
-- 1) MFA (TOTP via Supabase Auth). Enforcement lives in has_permission(), the single gate used by every
--    RLS policy and every admin function, so no screen or RPC can bypass it.
--    Roll-out is SAFE BY DEFAULT: nothing changes until the owner enrolls a factor and switches
--    enforcement on (Admin > Security). Break-glass SQL is in docs/02-MFA.md.
-- =========================================================
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings (key, value) values ('mfa_enforced', 'false') on conflict (key) do nothing;
drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function public.log_change();   -- details->>'id' is null for this table; key is inside details

alter table public.roles add column if not exists requires_mfa boolean not null default false;
update public.roles set requires_mfa = true where key in ('owner', 'manager');

create or replace function public._mfa_satisfied() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select value from public.app_settings where key = 'mfa_enforced'), 'false') <> 'true' then true
    when not exists (
      select 1 from public.staff_role_assignments a join public.roles r on r.id = a.role_id
      where a.user_id = (select auth.uid()) and r.requires_mfa) then true
    else coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
  end;
$$;
revoke all on function public._mfa_satisfied() from public, anon, authenticated;

create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public._mfa_satisfied() and exists (
    select 1
    from staff_profiles sp
    join staff_role_assignments a on a.user_id = sp.user_id
    join role_permissions rp on rp.role_id = a.role_id
    join permissions pm on pm.id = rp.permission_id
    where sp.user_id = (select auth.uid()) and sp.is_active and pm.key = p_key
  );
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

create or replace function public.my_permissions()
returns setof text language sql stable security definer set search_path = public as $$
  select pm.key
  from staff_profiles sp
  join staff_role_assignments a on a.user_id = sp.user_id
  join role_permissions rp on rp.role_id = a.role_id
  join permissions pm on pm.id = rp.permission_id
  where sp.user_id = (select auth.uid()) and sp.is_active and public._mfa_satisfied();
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public._mfa_satisfied() and exists (
    select 1 from staff_profiles sp
    join staff_role_assignments a on a.user_id = sp.user_id
    join roles r on r.id = a.role_id
    where sp.user_id = (select auth.uid()) and sp.is_active and r.key = 'owner');
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- What the login screen needs to decide between "enter code", "enroll now" and "go in".
create or replace function public.mfa_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enforced', coalesce((select value from public.app_settings where key = 'mfa_enforced'), 'false') = 'true',
    'is_staff', exists (select 1 from staff_profiles where user_id = (select auth.uid()) and is_active),
    'required', exists (
      select 1 from staff_profiles sp
      join staff_role_assignments a on a.user_id = sp.user_id
      join roles r on r.id = a.role_id
      where sp.user_id = (select auth.uid()) and sp.is_active and r.requires_mfa),
    'aal', (select auth.jwt() ->> 'aal'),
    'satisfied', public._mfa_satisfied());
$$;
revoke all on function public.mfa_status() from public, anon;
grant execute on function public.mfa_status() to authenticated;

-- Owner only. Turning enforcement ON requires the owner's CURRENT session to be aal2 (cannot lock yourself out).
create or replace function public.set_mfa_enforcement(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_on and coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then raise exception 'mfa_required'; end if;
  insert into public.app_settings (key, value) values ('mfa_enforced', (coalesce(p_on, false))::text)
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke all on function public.set_mfa_enforcement(boolean) from public, anon;
grant execute on function public.set_mfa_enforcement(boolean) to authenticated;

-- Owner only. The owner role always requires MFA.
create or replace function public.set_role_requires_mfa(p_role_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.roles where id = p_role_id) then raise exception 'role_not_found'; end if;
  if exists (select 1 from public.roles where id = p_role_id and key = 'owner') and not coalesce(p_on, false) then
    raise exception 'forbidden';
  end if;
  update public.roles set requires_mfa = coalesce(p_on, false) where id = p_role_id;
end $$;
revoke all on function public.set_role_requires_mfa(uuid, boolean) from public, anon;
grant execute on function public.set_role_requires_mfa(uuid, boolean) to authenticated;

-- Dry-run used by the invite-staff Edge Function BEFORE it sends any e-mail.
create or replace function public.can_grant_roles(p_role_ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_permission('staff.manage')
     and p_role_ids is not null and cardinality(p_role_ids) > 0
     and public._caller_can_grant(p_role_ids);
$$;
revoke all on function public.can_grant_roles(uuid[]) from public, anon;
grant execute on function public.can_grant_roles(uuid[]) to authenticated;

-- =========================================================
-- 2) RLS performance: evaluate the permission once per statement instead of once per row
--    (high-volume tables only).
-- =========================================================
drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders for select to authenticated
  using ((select public.has_permission('orders.view')));
drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items for select to authenticated
  using ((select public.has_permission('orders.view')));
drop policy if exists history_staff_read on public.order_status_history;
create policy history_staff_read on public.order_status_history for select to authenticated
  using ((select public.has_permission('orders.view')));
drop policy if exists customers_staff_read on public.customers;
create policy customers_staff_read on public.customers for select to authenticated
  using ((select public.has_permission('customers.view')));
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated
  using ((select public.has_permission('audit.view')));

-- =========================================================
-- 3) Storage: only image files, only inside an existing product's folder "<product_id>/<file>".
--    (The bucket already limits MIME types and size; this is defence in depth.)
--    A staff SELECT policy is added because some Storage API calls (remove/upsert) read the object first.
--    The bucket is public anyway, so this exposes nothing new.
-- =========================================================
drop policy if exists product_images_insert on storage.objects;
create policy product_images_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (public.has_permission('products.create') or public.has_permission('products.update'))
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    and exists (select 1 from public.products p where p.id::text = (storage.foldername(name))[1]));
drop policy if exists product_images_select_staff on storage.objects;
create policy product_images_select_staff on storage.objects for select to authenticated
  using (bucket_id = 'product-images'
         and (public.has_permission('products.view') or public.has_permission('products.update')));

-- =========================================================
-- 4) Indexes: foreign keys that were scanned sequentially (deleting a product / coupon / order set-null cascades)
-- =========================================================
create index if not exists order_items_product_idx on public.order_items (product_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);
create index if not exists orders_coupon_idx on public.orders (coupon_id);
create index if not exists coupon_redemptions_order_idx on public.coupon_redemptions (order_id);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity, created_at desc);

commit;
