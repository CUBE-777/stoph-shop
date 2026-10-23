-- Stoph Shop — Storefront upgrade / 12: admin-managed promotional carousel, best sellers, idempotent checkout.
-- BACKWARD COMPATIBLE: only adds objects (+ renames create_order's body to a private function behind a wrapper
-- with the SAME signature). Existing tables, columns, policies, data and URLs are untouched.
-- One transaction. NOT executed in the build environment (no PostgreSQL there) — run on a dev project first.
begin;

-- =========================================================
-- 1) Permission for banner management (owner + manager get it; change roles in Admin > Staff)
-- =========================================================
insert into public.permissions (key, description) values
  ('banners.manage', 'Manage the homepage promotional carousel (banners and carousel settings)')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p
  where p.key = 'banners.manage' and r.key in ('owner', 'manager')
on conflict do nothing;

-- =========================================================
-- 2) banners
-- =========================================================
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  title_ar text not null check (char_length(btrim(title_ar)) between 1 and 120),
  title_fr text not null check (char_length(btrim(title_fr)) between 1 and 120),
  subtitle_ar text check (subtitle_ar is null or char_length(subtitle_ar) <= 240),
  subtitle_fr text check (subtitle_fr is null or char_length(subtitle_fr) <= 240),
  button_ar text check (button_ar is null or char_length(button_ar) <= 40),
  button_fr text check (button_fr is null or char_length(button_fr) <= 40),
  link_type text not null default 'none' check (link_type in ('none', 'product', 'category', 'page', 'url')),
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  page_path text check (page_path is null or page_path in ('/', '/products', '/track', '/delivery', '/contact')),
  -- internal path ("/products?category=x") or https URL. No javascript:, data:, protocol-relative "//" links.
  link_url text check (link_url is null or link_url ~ '^/([^/[:space:]][^[:space:]]*)?$' or link_url ~ '^https://[^/[:space:]][^[:space:]]*$'),
  image_path text check (image_path is null or image_path ~ '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  mobile_image_path text check (mobile_image_path is null or mobile_image_path ~ '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  image_alt_ar text check (image_alt_ar is null or char_length(image_alt_ar) <= 200),
  image_alt_fr text check (image_alt_fr is null or char_length(image_alt_fr) <= 200),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  sort_order int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists banners_order_idx on public.banners (is_active, sort_order, created_at);
create index if not exists banners_product_idx on public.banners (product_id);
create index if not exists banners_category_idx on public.banners (category_id);

create or replace function public.banners_set_creator() returns trigger language plpgsql as $$
begin new.created_by := (select auth.uid()); return new; end $$;
drop trigger if exists banners_creator on public.banners;
create trigger banners_creator before insert on public.banners for each row execute function public.banners_set_creator();
drop trigger if exists banners_touch on public.banners;
create trigger banners_touch before update on public.banners for each row execute function public.touch_updated_at();
drop trigger if exists audit_banners on public.banners;
create trigger audit_banners after insert or update or delete on public.banners for each row execute function public.log_change();

alter table public.banners enable row level security;
revoke all on public.banners from anon, authenticated;
grant select on public.banners to anon, authenticated;
grant insert, update, delete on public.banners to authenticated;

-- Visitors only ever see enabled banners inside their schedule (the browser filter is a convenience, THIS is the rule).
drop policy if exists banners_public_read on public.banners;
create policy banners_public_read on public.banners for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
drop policy if exists banners_staff_read on public.banners;
create policy banners_staff_read on public.banners for select to authenticated
  using ((select public.has_permission('banners.manage')));
drop policy if exists banners_staff_insert on public.banners;
create policy banners_staff_insert on public.banners for insert to authenticated
  with check ((select public.has_permission('banners.manage')));
drop policy if exists banners_staff_update on public.banners;
create policy banners_staff_update on public.banners for update to authenticated
  using ((select public.has_permission('banners.manage'))) with check ((select public.has_permission('banners.manage')));
drop policy if exists banners_staff_delete on public.banners;
create policy banners_staff_delete on public.banners for delete to authenticated
  using ((select public.has_permission('banners.manage')));

-- =========================================================
-- 3) carousel settings (single row)
-- =========================================================
create table if not exists public.carousel_settings (
  id smallint primary key default 1 check (id = 1),
  autoplay boolean not null default true,
  interval_seconds int not null default 5 check (interval_seconds between 3 and 15),
  transition text not null default 'slide' check (transition in ('slide', 'fade')),
  updated_at timestamptz not null default now()
);
insert into public.carousel_settings (id) values (1) on conflict (id) do nothing;
drop trigger if exists carousel_touch on public.carousel_settings;
create trigger carousel_touch before update on public.carousel_settings for each row execute function public.touch_updated_at();
drop trigger if exists audit_carousel on public.carousel_settings;
create trigger audit_carousel after update on public.carousel_settings for each row execute function public.log_change();
alter table public.carousel_settings enable row level security;
revoke all on public.carousel_settings from anon, authenticated;
grant select on public.carousel_settings to anon, authenticated;
grant update (autoplay, interval_seconds, transition) on public.carousel_settings to authenticated;
drop policy if exists carousel_read on public.carousel_settings;
create policy carousel_read on public.carousel_settings for select to anon, authenticated using (true);
drop policy if exists carousel_update on public.carousel_settings;
create policy carousel_update on public.carousel_settings for update to authenticated
  using ((select public.has_permission('banners.manage'))) with check ((select public.has_permission('banners.manage')));

-- =========================================================
-- 4) Storage: separate PUBLIC bucket for banner images (product-images policies stay as they are).
--    Only staff with banners.manage can write; file names must be "<uuid>.<jpg|jpeg|png|webp>" at the bucket root.
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banner-images', 'banner-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists banner_images_insert on storage.objects;
create policy banner_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'banner-images' and (select public.has_permission('banners.manage'))
              and name ~ '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$');
drop policy if exists banner_images_select_staff on storage.objects;
create policy banner_images_select_staff on storage.objects for select to authenticated
  using (bucket_id = 'banner-images' and (select public.has_permission('banners.manage')));
drop policy if exists banner_images_update on storage.objects;
create policy banner_images_update on storage.objects for update to authenticated
  using (bucket_id = 'banner-images' and (select public.has_permission('banners.manage')))
  with check (bucket_id = 'banner-images' and (select public.has_permission('banners.manage')));
drop policy if exists banner_images_delete on storage.objects;
create policy banner_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'banner-images' and (select public.has_permission('banners.manage')));

-- =========================================================
-- 5) Best sellers: only product ids, ranked by units in CONFIRMED-or-later orders (not new / cancelled / returned).
--    No counts are exposed, so the storefront shows a ranking, never sales figures.
-- =========================================================
create or replace function public.best_selling_products(p_limit int default 8)
returns table (product_id uuid) language sql stable security definer set search_path = public as $$
  select i.product_id
  from public.order_items i
  join public.orders o on o.id = i.order_id
  join public.products p on p.id = i.product_id
  where p.is_published and o.status in ('confirmed', 'preparing', 'shipped', 'delivered')
  group by i.product_id, p.created_at
  order by sum(i.quantity) desc, p.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;
revoke all on function public.best_selling_products(int) from public;
grant execute on function public.best_selling_products(int) to anon, authenticated;

-- =========================================================
-- 6) Idempotent checkout. The browser sends a random client_token inside p_customer. A repeat of the same token
--    (double tap, retry after a timeout) returns the SAME order instead of creating a second one.
--    Same signature as before: create_order(jsonb, jsonb, text). Without a token, behaviour is unchanged.
-- =========================================================
create table if not exists public.order_requests (
  token uuid primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.order_requests enable row level security;
revoke all on public.order_requests from anon, authenticated;

do $$
begin
  if to_regprocedure('public._create_order_core(jsonb,jsonb,text)') is null then
    alter function public.create_order(jsonb, jsonb, text) rename to _create_order_core;
  end if;
end $$;
revoke all on function public._create_order_core(jsonb, jsonb, text) from public, anon, authenticated;

create or replace function public.create_order(p_customer jsonb, p_items jsonb, p_coupon text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token uuid; v_res jsonb; v_prev jsonb;
begin
  begin
    v_token := nullif(btrim(coalesce(p_customer->>'client_token', '')), '')::uuid;
  exception when others then
    raise exception 'invalid_token';
  end;
  if v_token is null then
    return public._create_order_core(p_customer, p_items, p_coupon);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_token::text, 0));   -- two simultaneous taps with the same token run one after the other
  select result into v_prev from public.order_requests where token = v_token;
  if found then return v_prev || jsonb_build_object('duplicate', true); end if;

  v_res := public._create_order_core(p_customer, p_items, p_coupon);
  if not (v_res ? 'error') then                                          -- failures (e.g. bad coupon) are not stored: the visitor can fix and retry
    insert into public.order_requests (token, result) values (v_token, v_res);
  end if;
  if random() < 0.02 then delete from public.order_requests where created_at < now() - interval '7 days'; end if;
  return v_res;
end $$;
revoke all on function public.create_order(jsonb, jsonb, text) from public;
grant execute on function public.create_order(jsonb, jsonb, text) to anon, authenticated;

commit;
