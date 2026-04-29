-- Allow household owners to update other members in their family.
-- This complements family_members_update_self (which lets a user edit
-- their own row). With both policies present, RLS allows the update if
-- either condition holds.
create policy family_members_update_owner on public.family_members
  for update to authenticated
  using (
    family_id = public.current_family_id()
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = public.family_members.family_id
        and fm.auth_user_id = auth.uid()
        and fm.is_owner = true
    )
  )
  with check (family_id = public.current_family_id());
