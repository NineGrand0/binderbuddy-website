-- Creates the signed-in user's profile if it's missing — for accounts made before the sign-up
-- trigger existed, or if that trigger ever failed. Without a profile the app can't load the account.
-- Run once in the Supabase dashboard (SQL Editor → New query → paste → Run).

create or replace function public.ensure_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  insert into public.profiles (id, display_name)
  select u.id, coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1))
  from auth.users as u
  where u.id = uid
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;
