-- Stoph Shop — Phase 2 / 07: RLS for the new permission keys + staff/role management. Run after 06.
begin;

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_transitions enable row level security;
alter table public.rate_events enable row level security;

revoke all on public.coupons, public.coupon_redemptions, public.order_status_history,
  public.order_transitions, public.rate_events from anon;
revoke all on public.rate_events from authenticated;             -- internal only
-- The audit log is append-only for everybody who is not the database owner.
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;
-- Staff can read customers but may only edit name + internal notes (never phone / id).
revoke insert, update, delete on public.customers from anon, authenticated;
grant update (full_name, staff_notes) on public.customers to authenticated;

-- ---------- Products (split permissions) ----------
drop policy if exists products_staff_all on public.products;
drop policy if exists products_staff_select on public.products;
create policy products_staff_select on public.products for select to authenticated
  using (public.has_permission('products.view') or public.has_permission('products.update') or public.has_permission('products.create'));
drop policy if exists products_staff_insert on public.products;
create policy products_staff_insert on public.products for insert to authenticated
  with check (public.has_permission('products.create'));
drop policy if exists products_staff_update on public.products;
create policy products_staff_update on public.products for update to authenticated
  using (public.has_permission('products.update')) with check (public.has_permission('products.update'));
drop policy if exists products_staff_delete on public.products;
create policy products_staff_delete on public.products for delete to authenticated
  using (public.has_permission('products.delete'));

drop policy if exists images_staff_all on public.product_images;
drop policy if exists images_staff_select on public.product_images;
create policy images_staff_select on public.product_images for select to authenticated
  using (public.has_permission('products.view') or public.has_permission('products.update'));
drop policy if exists images_staff_insert on public.product_images;
create policy images_staff_insert on public.product_images for insert to authenticated
  with check (public.has_permission('products.create') or public.has_permission('products.update'));
drop policy if exists images_staff_update on public.product_images;
create policy images_staff_update on public.product_images for update to authenticated
  using (public.has_permission('products.update')) with check (public.has_permission('products.update'));
drop policy if exists images_staff_delete on public.product_images;
create policy images_staff_delete on public.product_images for delete to authenticated
  using (public.has_permission('products.update') or public.has_permission('products.delete'));

drop policy if exists variants_staff_all on public.product_variants;
drop policy if exists variants_staff_select on public.product_variants;
create policy variants_staff_select on public.product_variants for select to authenticated
  using (public.has_permission('products.view') or public.has_permission('products.update'));
drop policy if exists variants_staff_insert on public.product_variants;
create policy variants_staff_insert on public.product_variants for insert to authenticated
  with check (public.has_permission('products.create') or public.has_permission('products.update'));
drop policy if exists variants_staff_update on public.product_variants;
create policy variants_staff_update on public.product_variants for update to authenticated
  using (public.has_permission('products.update')) with check (public.has_permission('products.update'));
drop policy if exists variants_staff_delete on public.product_variants;
create policy variants_staff_delete on public.product_variants for delete to authenticated
  using (public.has_permission('products.update') or public.has_permission('products.delete'));

-- ---------- Storage (product images) ----------
drop policy if exists product_images_insert on storage.objects;
drop policy if exists product_images_update on storage.objects;
drop policy if exists product_images_delete on storage.objects;
drop policy if exists product_images_insert on storage.objects;
create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (public.has_permission('products.create') or public.has_permission('products.update')));
drop policy if exists product_images_update on storage.objects;
create policy product_images_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_permission('products.update'));
drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (public.has_permission('products.update') or public.has_permission('products.delete')));

-- ---------- Customers ----------
drop policy if exists customers_staff_read on public.customers;
drop policy if exists customers_staff_read on public.customers;
create policy customers_staff_read on public.customers for select to authenticated
  using (public.has_permission('customers.view'));
drop policy if exists customers_staff_update on public.customers;
create policy customers_staff_update on public.customers for update to authenticated
  using (public.has_permission('customers.update')) with check (public.has_permission('customers.update'));

-- ---------- Orders, history, transitions ----------
drop policy if exists history_staff_read on public.order_status_history;
create policy history_staff_read on public.order_status_history for select to authenticated
  using (public.has_permission('orders.view'));
drop policy if exists transitions_staff_read on public.order_transitions;
create policy transitions_staff_read on public.order_transitions for select to authenticated
  using (public.has_permission('orders.view'));

-- ---------- Coupons ----------
drop policy if exists coupons_staff_all on public.coupons;
create policy coupons_staff_all on public.coupons for all to authenticated
  using (public.has_permission('coupons.manage')) with check (public.has_permission('coupons.manage'));
drop policy if exists redemptions_staff_read on public.coupon_redemptions;
create policy redemptions_staff_read on public.coupon_redemptions for select to authenticated
  using (public.has_permission('coupons.manage'));

-- ---------- Staff / roles (read only from the app; writes ONLY via the functions below) ----------
drop policy if exists staff_self_read on public.staff_profiles;
drop policy if exists assignments_read on public.staff_role_assignments;
drop policy if exists roles_read on public.roles;
drop policy if exists permissions_read on public.permissions;
drop policy if exists role_permissions_read on public.role_permissions;
drop policy if exists staff_self_read on public.staff_profiles;
create policy staff_self_read on public.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('staff.manage'));
drop policy if exists assignments_read on public.staff_role_assignments;
create policy assignments_read on public.staff_role_assignments for select to authenticated
  using (user_id = (select auth.uid()) or public.has_permission('staff.manage'));
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (public.has_permission('staff.manage'));
drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select to authenticated using (public.has_permission('staff.manage'));
drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using (public.has_permission('staff.manage'));

-- =========================================================
-- Staff & role management (security definer; no direct table writes exist for staff)
-- Rules enforced here, on the server:
--   * you can never change your own roles or active flag
--   * you can only grant/remove roles whose permissions you already hold (owner: anything)
--   * the "owner" role can only be handled by an owner
--   * the last active owner can never be removed
-- =========================================================
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_profiles sp
    join staff_role_assignments a on a.user_id = sp.user_id
    join roles r on r.id = a.role_id
    where sp.user_id = (select auth.uid()) and sp.is_active and r.key = 'owner');
$$;

create or replace function public._caller_can_grant(p_role_ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or (
    not exists (select 1 from roles r where r.id = any(coalesce(p_role_ids, '{}')) and r.key = 'owner')
    and not exists (
      select 1 from role_permissions rp join permissions pm on pm.id = rp.permission_id
      where rp.role_id = any(coalesce(p_role_ids, '{}'))
        and pm.key not in (select m from public.my_permissions() m)));
$$;

create or replace function public._assert_owner_remains() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from staff_role_assignments a join roles r on r.id = a.role_id
    join staff_profiles sp on sp.user_id = a.user_id
    where r.key = 'owner' and sp.is_active) then
    raise exception 'last_owner';
  end if;
end $$;

create or replace function public.list_staff()
returns table (user_id uuid, email text, full_name text, is_active boolean, role_ids uuid[])
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.has_permission('staff.manage') then raise exception 'forbidden'; end if;
  return query
    select sp.user_id, u.email::text, sp.full_name, sp.is_active,
           coalesce(array_agg(a.role_id) filter (where a.role_id is not null), '{}')
    from staff_profiles sp
    join auth.users u on u.id = sp.user_id
    left join staff_role_assignments a on a.user_id = sp.user_id
    group by sp.user_id, u.email, sp.full_name, sp.is_active
    order by u.email;
end $$;

-- Registers an EXISTING Supabase Auth user (invited from the dashboard or via the invite-staff function) as staff.
create or replace function public.register_staff_by_email(p_email text, p_full_name text, p_role_ids uuid[])
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not public.has_permission('staff.manage') then raise exception 'forbidden'; end if;
  if p_role_ids is null or cardinality(p_role_ids) = 0 then raise exception 'role_required'; end if;
  if not public._caller_can_grant(p_role_ids) then raise exception 'forbidden'; end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then raise exception 'user_not_found'; end if;
  if v_uid = (select auth.uid()) then raise exception 'forbidden'; end if;
  if exists (select 1 from staff_profiles where user_id = v_uid) then raise exception 'already_staff'; end if;
  insert into staff_profiles (user_id, full_name) values (v_uid, nullif(btrim(p_full_name), ''));
  insert into staff_role_assignments (user_id, role_id) select v_uid, unnest(p_role_ids);
end $$;

create or replace function public.set_staff_roles(p_user uuid, p_role_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('staff.manage') then raise exception 'forbidden'; end if;
  if p_user = (select auth.uid()) then raise exception 'forbidden'; end if;
  if not exists (select 1 from staff_profiles where user_id = p_user) then raise exception 'user_not_found'; end if;
  if not public._caller_can_grant(p_role_ids)
     or not public._caller_can_grant(array(select role_id from staff_role_assignments where user_id = p_user)) then
    raise exception 'forbidden';
  end if;
  delete from staff_role_assignments where user_id = p_user;
  insert into staff_role_assignments (user_id, role_id) select p_user, unnest(coalesce(p_role_ids, '{}'));
  perform public._assert_owner_remains();
end $$;

create or replace function public.set_staff_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('staff.manage') then raise exception 'forbidden'; end if;
  if p_user = (select auth.uid()) then raise exception 'forbidden'; end if;
  if not public._caller_can_grant(array(select role_id from staff_role_assignments where user_id = p_user)) then
    raise exception 'forbidden';
  end if;
  update staff_profiles set is_active = p_active where user_id = p_user;
  perform public._assert_owner_remains();
end $$;

-- Roles and their permission sets: owner only. The "owner" role itself is immutable.
create or replace function public.create_role(p_key text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_key !~ '^[a-z][a-z0-9_]{1,30}$' or char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'invalid_role'; end if;
  insert into roles (key, name) values (p_key, btrim(p_name)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_role_permissions(p_role_id uuid, p_keys text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if exists (select 1 from roles where id = p_role_id and key = 'owner') then raise exception 'forbidden'; end if;
  if not exists (select 1 from roles where id = p_role_id) then raise exception 'role_not_found'; end if;
  delete from role_permissions where role_id = p_role_id;
  insert into role_permissions (role_id, permission_id)
    select p_role_id, id from permissions where key = any(coalesce(p_keys, '{}'));
end $$;

-- Customers list with totals (customers.view). Contact data only, no order contents.
create or replace function public.admin_customers(p_search text default null, p_limit int default 100)
returns table (id uuid, full_name text, phone text, staff_notes text, created_at timestamptz,
               orders_count bigint, last_order_at timestamptz, delivered_total numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.has_permission('customers.view') then raise exception 'forbidden'; end if;
  return query
    select c.id, c.full_name, c.phone, c.staff_notes, c.created_at,
           count(o.id), max(o.created_at),
           coalesce(sum(o.total) filter (where o.status = 'delivered'), 0)
    from customers c left join orders o on o.customer_id = c.id
    where v_q is null
       or c.name_key like '%' || public.name_key(v_q) || '%'
       or c.phone like '%' || regexp_replace(v_q, '[^0-9]', '', 'g') || '%' and regexp_replace(v_q, '[^0-9]', '', 'g') <> ''
    group by c.id
    order by max(o.created_at) desc nulls last
    limit least(greatest(p_limit, 1), 300);
end $$;

-- Execute rights: staff functions are for signed-in users only.
revoke all on function public.is_owner(), public._caller_can_grant(uuid[]), public._assert_owner_remains(),
  public.list_staff(), public.register_staff_by_email(text, text, uuid[]), public.set_staff_roles(uuid, uuid[]),
  public.set_staff_active(uuid, boolean), public.create_role(text, text), public.set_role_permissions(uuid, text[]),
  public.admin_customers(text, int) from public, anon;
grant execute on function public.is_owner(), public.list_staff(), public.register_staff_by_email(text, text, uuid[]),
  public.set_staff_roles(uuid, uuid[]), public.set_staff_active(uuid, boolean), public.create_role(text, text),
  public.set_role_permissions(uuid, text[]), public.admin_customers(text, int) to authenticated;

commit;
