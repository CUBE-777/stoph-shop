-- Stoph Shop — 04 first admin (run ONCE, only after you created the user).
--
-- 1) Supabase Dashboard > Authentication > Users > "Add user" > "Create new user":
--    enter YOUR email and a strong password you choose (never put it in code or Git).
-- 2) Authentication > Sign In / Providers > turn OFF "Allow new users to sign up".
-- 3) Replace the email below with yours and run this file in the SQL Editor.

create or replace function public.bootstrap_first_owner(p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid; v_role uuid;
begin
  if exists (select 1 from staff_role_assignments a join roles r on r.id = a.role_id where r.key = 'owner') then
    raise exception 'An owner already exists. Manage staff via SQL or the phase-2 UI.';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then raise exception 'No auth user with this email. Create the user first.'; end if;
  select id into v_role from roles where key = 'owner';
  insert into staff_profiles (user_id, full_name) values (v_uid, p_email) on conflict do nothing;
  insert into staff_role_assignments (user_id, role_id) values (v_uid, v_role);
end $$;

-- Not callable from the browser, in any way.
revoke all on function public.bootstrap_first_owner(text) from public, anon, authenticated;

select public.bootstrap_first_owner('CHANGE-ME@example.com');
