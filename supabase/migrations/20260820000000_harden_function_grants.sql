-- Security-advisor hardening: Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE on new public-schema functions to anon/authenticated explicitly,
-- so the earlier `revoke ... from public` statements never removed anon's
-- grant. All of these functions already guard with auth.uid() (or return
-- null without it), so this changes no app behaviour — it just removes the
-- anonymous API surface the advisor flags.
--
-- NOTE for future migrations: `create or replace function` re-applies the
-- default grants. Any new SECURITY DEFINER function needs its own explicit
-- `revoke execute ... from public, anon;` after creation.

revoke execute on function public.current_family_id() from public, anon;
revoke execute on function public.create_family_for_current_user(text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.create_family_invitation(text, text, text) from public, anon;
revoke execute on function public.accept_family_invitation(text) from public, anon;

-- Trigger function: EXECUTE is checked against the table owner when the
-- trigger is created, never against the DML caller, so no role needs a
-- grant here at all.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
