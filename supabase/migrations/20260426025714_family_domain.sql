-- ─── Tables ────────────────────────────────────────────────

create table public.families (
  id uuid primary key default gen_random_uuid(),
  household_name text not null,
  city text,
  timezone text not null default 'America/New_York',
  locale text not null check (locale in ('en','es')) default 'en',
  methodology text check (methodology in ('montessori','reggio','waldorf','play-based','outdoor','stem','mixed')),
  density text not null check (density in ('calm','balanced','packed')) default 'balanced',
  agent_level text not null check (agent_level in ('hidden','subtle','transparent')) default 'transparent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger families_set_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('mom','dad','caregiver','grandparent','partner','other')) default 'other',
  avatar_color text not null default 'flamingo',
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (family_id, auth_user_id)
);

create index family_members_auth_user_id_idx on public.family_members(auth_user_id);
create index family_members_family_id_idx on public.family_members(family_id);

create table public.kids (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  age int not null check (age >= 0 and age <= 18),
  avatar_color text not null default 'sunset',
  color text not null default 'sunset',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kids_family_id_idx on public.kids(family_id);

create trigger kids_set_updated_at
  before update on public.kids
  for each row execute function public.set_updated_at();

create table public.family_preferences (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('value','constraint','dislike')),
  text text not null,
  created_at timestamptz not null default now()
);

create index family_preferences_family_id_kind_idx on public.family_preferences(family_id, kind);

-- ─── Helpers ───────────────────────────────────────────────

-- Returns the family_id of the currently-authenticated user, or null.
-- Used by every family-scoped RLS policy.
create or replace function public.current_family_id()
returns uuid
language sql
stable
security invoker
set search_path = public, auth
as $$
  select family_id
  from public.family_members
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- Atomic family + first-member creation for onboarding.
-- security definer so it can insert the first family + member without
-- needing a permissive insert policy on either table.
create or replace function public.create_family_for_current_user(
  p_household_name text,
  p_city text,
  p_timezone text,
  p_locale text,
  p_member_name text,
  p_member_role text,
  p_member_avatar_color text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.family_members where auth_user_id = v_user_id) then
    raise exception 'User already belongs to a family';
  end if;

  insert into public.families (household_name, city, timezone, locale)
  values (
    p_household_name,
    p_city,
    coalesce(nullif(p_timezone, ''), 'America/New_York'),
    coalesce(nullif(p_locale, ''), 'en')
  )
  returning id into v_family_id;

  insert into public.family_members (family_id, auth_user_id, name, role, avatar_color, is_owner)
  values (
    v_family_id,
    v_user_id,
    p_member_name,
    coalesce(nullif(p_member_role, ''), 'other'),
    coalesce(nullif(p_member_avatar_color, ''), 'flamingo'),
    true
  );

  return v_family_id;
end;
$$;

revoke all on function public.create_family_for_current_user(text, text, text, text, text, text, text) from public;
grant execute on function public.create_family_for_current_user(text, text, text, text, text, text, text) to authenticated;

-- ─── RLS ───────────────────────────────────────────────────

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.kids enable row level security;
alter table public.family_preferences enable row level security;

-- families: select+update for members; insert is RPC-only (no policy).
create policy families_select_own on public.families
  for select to authenticated
  using (id = public.current_family_id());

create policy families_update_owner on public.families
  for update to authenticated
  using (
    id = public.current_family_id()
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = public.families.id
        and fm.auth_user_id = auth.uid()
        and fm.is_owner = true
    )
  )
  with check (id = public.current_family_id());

-- family_members: select all family members; update yourself; owner deletes others.
-- Insert is intentionally not allowed — the RPC creates the first member;
-- adding more members will go through a future invite flow.
create policy family_members_select_own on public.family_members
  for select to authenticated
  using (family_id = public.current_family_id());

create policy family_members_update_self on public.family_members
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy family_members_delete_owner on public.family_members
  for delete to authenticated
  using (
    family_id = public.current_family_id()
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = public.family_members.family_id
        and fm.auth_user_id = auth.uid()
        and fm.is_owner = true
    )
  );

-- kids: full access for any member of the family.
create policy kids_all_family on public.kids
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- family_preferences: full access for any member of the family.
create policy family_preferences_all_family on public.family_preferences
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
