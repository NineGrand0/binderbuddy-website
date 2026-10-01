-- BinderBuddy accounts: profiles, cards and binders, each readable and writable only by its owner,
-- and only after the owner has passed two-factor authentication (session AAL2).
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.

-- ── Profiles ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  share_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  -- Server-owned: users can read these but never change them directly
  is_premium boolean not null default false,
  premium_purchased_at timestamptz,
  premium_payment_method text,
  role text not null default 'user' check (role in ('user', 'admin')),
  -- App flags that must follow the account across devices (demo cards seeded, migrations run)
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Every new auth user gets a profile; display name comes from the sign-up form
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Cards and binders: one row per item, the app's own JSON shape in `data` ─────────────────────
create table if not exists public.cards (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.binders (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── Row Level Security ──────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.binders enable row level security;

-- Signed-out visitors get nothing
revoke all on public.profiles, public.cards, public.binders from anon;

-- Profiles: read your own; change only your display name and app flags
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, prefs) on public.profiles to authenticated;

drop policy if exists "Own profile: read" on public.profiles;
create policy "Own profile: read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Own profile: update" on public.profiles;
create policy "Own profile: update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Cards and binders: full control over your own rows only
grant select, insert, update, delete on public.cards, public.binders to authenticated;

drop policy if exists "Own cards" on public.cards;
create policy "Own cards" on public.cards
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Own binders" on public.binders;
create policy "Own binders" on public.binders
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Two-factor required: a password-only (AAL1) session can't read or write any of it.
-- Restrictive policies are ANDed with the ones above.
drop policy if exists "Require 2FA" on public.profiles;
create policy "Require 2FA" on public.profiles
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Require 2FA" on public.cards;
create policy "Require 2FA" on public.cards
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Require 2FA" on public.binders;
create policy "Require 2FA" on public.binders
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ── Premium (prototype) ─────────────────────────────────────────────────────────────────────────
-- The Premium page takes no real payment yet, so this lets a signed-in user unlock it for
-- themselves — same as before, but now recorded on the server. When real payments arrive,
-- drop this and set is_premium from the payment provider's webhook (with the secret key) instead.
create or replace function public.activate_premium(method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select auth.jwt() ->> 'aal') <> 'aal2' then
    raise exception 'Sign in with two-factor authentication first';
  end if;
  if method not in ('card', 'paypal', 'apple_pay') then
    raise exception 'Unknown payment method';
  end if;
  update public.profiles
     set is_premium = true,
         premium_purchased_at = coalesce(premium_purchased_at, now()),
         premium_payment_method = coalesce(premium_payment_method, method)
   where id = (select auth.uid());
end;
$$;

revoke all on function public.activate_premium(text) from public, anon;
grant execute on function public.activate_premium(text) to authenticated;
