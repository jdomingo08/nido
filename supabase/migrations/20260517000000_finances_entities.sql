create table public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('personal','business')),
  family_id uuid references public.families(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A personal entity is family-scoped, a business entity is user-scoped.
  check (
    (kind = 'personal' and family_id is not null and owner_user_id is null) or
    (kind = 'business' and owner_user_id is not null and family_id is null)
  )
);

create unique index entities_personal_per_family_idx
  on public.entities(family_id) where kind = 'personal' and archived = false;

create index entities_owner_idx on public.entities(owner_user_id);

create trigger entities_set_updated_at
  before update on public.entities
  for each row execute function public.set_updated_at();

create table public.entity_members (
  entity_id uuid not null references public.entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')) default 'member',
  created_at timestamptz not null default now(),
  primary key (entity_id, user_id)
);

create index entity_members_user_idx on public.entity_members(user_id);

-- Helper used by all finance RLS policies.
create or replace function public.current_user_entity_ids()
returns uuid[]
language sql
stable
security invoker
set search_path = public, auth
as $$
  select coalesce(array_agg(entity_id), '{}'::uuid[])
  from public.entity_members
  where user_id = auth.uid();
$$;

-- RLS
alter table public.entities enable row level security;
alter table public.entity_members enable row level security;

create policy entities_select on public.entities
  for select to authenticated
  using (id = any(public.current_user_entity_ids()));

create policy entities_update on public.entities
  for update to authenticated
  using (id = any(public.current_user_entity_ids()))
  with check (id = any(public.current_user_entity_ids()));

-- entity_members: a user can see their own membership rows, period.
create policy entity_members_select_own on public.entity_members
  for select to authenticated
  using (user_id = auth.uid() or entity_id = any(public.current_user_entity_ids()));

-- Inserts/deletes happen via SECURITY DEFINER RPCs only.
-- No client-side INSERT or DELETE policy on entity_members.

-- Backfill: one Personal entity per existing family, with all current members.
insert into public.entities (name, kind, family_id)
select household_name, 'personal', id from public.families;

insert into public.entity_members (entity_id, user_id, role)
select e.id, fm.auth_user_id,
       case when fm.is_owner then 'owner' else 'member' end
from public.entities e
join public.family_members fm on fm.family_id = e.family_id
where e.kind = 'personal';

-- Auto-create Personal entity on new family + membership rows.
create or replace function public.handle_new_family_personal_entity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entity_id uuid;
begin
  insert into public.entities (name, kind, family_id)
  values (new.household_name, 'personal', new.id)
  returning id into v_entity_id;
  return new;
end;
$$;

create trigger families_create_personal_entity
  after insert on public.families
  for each row execute function public.handle_new_family_personal_entity();

create or replace function public.handle_new_family_member_entity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entity_id uuid;
begin
  select id into v_entity_id
  from public.entities
  where family_id = new.family_id and kind = 'personal' and archived = false
  limit 1;

  if v_entity_id is not null then
    insert into public.entity_members (entity_id, user_id, role)
    values (v_entity_id, new.auth_user_id,
            case when new.is_owner then 'owner' else 'member' end)
    on conflict (entity_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger family_members_join_personal_entity
  after insert on public.family_members
  for each row execute function public.handle_new_family_member_entity();
