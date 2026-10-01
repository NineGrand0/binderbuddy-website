-- Two-factor becomes optional, and passkeys count as a strong sign-in.
-- Run once in the Supabase dashboard (SQL Editor → New query → paste → Run), after the first migration.
--
-- A session may use the account's data when ANY of these hold:
--   • it passed two-factor (AAL2), or
--   • it signed in with a passkey (device + biometric/PIN — already more than a password), or
--   • the account has no authenticator app set up (the owner chose to skip 2FA).
-- So once someone turns 2FA on, a stolen password alone still can't read their data.

create or replace function public.session_meets_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or exists (
      select 1
      from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as method
      where method ->> 'method' in ('passkey', 'webauthn')
    )
    or not exists (
      select 1
      from auth.mfa_factors as factor
      where factor.user_id = auth.uid()
        and factor.status = 'verified'
    );
$$;

revoke all on function public.session_meets_mfa() from public, anon;
grant execute on function public.session_meets_mfa() to authenticated;

-- Replace the "always AAL2" rule from the first migration (dropping only these policies, not data)
drop policy if exists "Require 2FA" on public.profiles;
drop policy if exists "Require 2FA" on public.cards;
drop policy if exists "Require 2FA" on public.binders;

drop policy if exists "Require 2FA if enabled" on public.profiles;
create policy "Require 2FA if enabled" on public.profiles
  as restrictive for all to authenticated
  using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));

drop policy if exists "Require 2FA if enabled" on public.cards;
create policy "Require 2FA if enabled" on public.cards
  as restrictive for all to authenticated
  using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));

drop policy if exists "Require 2FA if enabled" on public.binders;
create policy "Require 2FA if enabled" on public.binders
  as restrictive for all to authenticated
  using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));

-- Premium (prototype) follows the same rule
create or replace function public.activate_premium(method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.session_meets_mfa()) then
    raise exception 'Finish signing in (two-factor or passkey) first';
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
