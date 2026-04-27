-- The current_family_id() helper queries family_members, but family_members
-- has an RLS policy that itself calls current_family_id() — infinite recursion.
-- Marking the helper SECURITY DEFINER so it bypasses RLS when running.
-- It still filters by auth.uid(), so it can only ever return the caller's own
-- family — safe by construction.
create or replace function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select family_id
  from public.family_members
  where auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_family_id() from public;
grant execute on function public.current_family_id() to authenticated;
