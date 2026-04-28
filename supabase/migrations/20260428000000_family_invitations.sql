-- ─── family_invitations ────────────────────────────────────
-- Token-based invite flow. Owner sends invite → invitee gets a Supabase
-- magic-link email → after sign-in they hit /invite/accept which calls
-- accept_family_invitation(token) to add them to the family.

create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  email text not null,
  role text not null check (role in ('mom','dad','caregiver','grandparent','partner','other')) default 'other',
  avatar_color text not null default 'flamingo',
  token text not null unique,
  status text not null check (status in ('pending','accepted','revoked','expired')) default 'pending',
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index family_invitations_family_id_idx on public.family_invitations(family_id);
create index family_invitations_token_idx on public.family_invitations(token);

-- Only one pending invite per (family, email).
create unique index family_invitations_pending_unique
  on public.family_invitations(family_id, lower(email))
  where status = 'pending';

alter table public.family_invitations enable row level security;

-- Family members (any role) can read invitations for their family.
create policy family_invitations_select_family on public.family_invitations
  for select to authenticated
  using (family_id = public.current_family_id());

-- Only owners can revoke/update invitations. (INSERT goes through RPC.)
create policy family_invitations_update_owner on public.family_invitations
  for update to authenticated
  using (
    family_id = public.current_family_id()
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = public.family_invitations.family_id
        and fm.auth_user_id = auth.uid()
        and fm.is_owner = true
    )
  )
  with check (family_id = public.current_family_id());

create policy family_invitations_delete_owner on public.family_invitations
  for delete to authenticated
  using (
    family_id = public.current_family_id()
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = public.family_invitations.family_id
        and fm.auth_user_id = auth.uid()
        and fm.is_owner = true
    )
  );

-- ─── RPC: create_family_invitation ─────────────────────────
-- Owner-only. Generates a token, inserts the invitation, returns the token.
create or replace function public.create_family_invitation(
  p_email text,
  p_role text,
  p_avatar_color text
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
  v_token text;
  v_email text := lower(trim(p_email));
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Caller must be a family owner.
  select fm.family_id into v_family_id
  from public.family_members fm
  where fm.auth_user_id = v_user_id and fm.is_owner = true
  limit 1;

  if v_family_id is null then
    raise exception 'Only family owners can send invitations';
  end if;

  if v_email is null or v_email = '' then
    raise exception 'Email is required';
  end if;

  -- Reject if email is already a member of this family.
  if exists (
    select 1 from public.family_members fm
    join auth.users u on u.id = fm.auth_user_id
    where fm.family_id = v_family_id
      and lower(u.email) = v_email
  ) then
    raise exception 'That email is already a member of this family';
  end if;

  -- Reject if a pending invitation already exists.
  if exists (
    select 1 from public.family_invitations
    where family_id = v_family_id
      and lower(email) = v_email
      and status = 'pending'
  ) then
    raise exception 'A pending invitation already exists for that email';
  end if;

  -- 64-char hex token from two concatenated UUIDs (no pgcrypto dependency).
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.family_invitations (
    family_id, email, role, avatar_color, token, invited_by
  ) values (
    v_family_id,
    v_email,
    coalesce(nullif(p_role, ''), 'other'),
    coalesce(nullif(p_avatar_color, ''), 'flamingo'),
    v_token,
    v_user_id
  );

  return v_token;
end;
$$;

revoke all on function public.create_family_invitation(text, text, text) from public;
grant execute on function public.create_family_invitation(text, text, text) to authenticated;

-- ─── RPC: accept_family_invitation ─────────────────────────
-- Callable by any authenticated user. Validates token + email match,
-- inserts a family_members row, marks invitation accepted.
create or replace function public.accept_family_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation public.family_invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  if v_user_email is null then
    raise exception 'No email on your account';
  end if;

  -- Already a member of some family? Reject — single-family per user for v1.
  if exists (select 1 from public.family_members where auth_user_id = v_user_id) then
    raise exception 'You already belong to a family. Sign out of that family first.';
  end if;

  select * into v_invitation
  from public.family_invitations
  where token = p_token
  for update;

  if v_invitation.id is null then
    raise exception 'Invitation not found';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'Invitation is no longer valid';
  end if;

  if v_invitation.expires_at < now() then
    update public.family_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'Invitation has expired';
  end if;

  if lower(v_invitation.email) <> lower(v_user_email) then
    raise exception 'Invitation email does not match your account';
  end if;

  insert into public.family_members (
    family_id, auth_user_id, name, role, avatar_color, is_owner
  ) values (
    v_invitation.family_id,
    v_user_id,
    -- Default to email local part; can be edited in settings.
    split_part(v_user_email, '@', 1),
    v_invitation.role,
    v_invitation.avatar_color,
    false
  );

  update public.family_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_user_id
  where id = v_invitation.id;

  return v_invitation.family_id;
end;
$$;

revoke all on function public.accept_family_invitation(text) from public;
grant execute on function public.accept_family_invitation(text) to authenticated;
