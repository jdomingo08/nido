create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  plaid_item_id text not null unique,
  institution_id text,
  institution_name text not null,
  access_token_ciphertext bytea not null,    -- encrypted blob
  access_token_nonce bytea not null,         -- 12-byte GCM nonce
  access_token_tag bytea not null,           -- 16-byte GCM auth tag
  cursor text,                               -- transactionsSync cursor (Phase 2)
  status text not null check (status in ('active','login_required','error','disconnected')) default 'active',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plaid_items_entity_idx on public.plaid_items(entity_id);

create trigger plaid_items_set_updated_at
  before update on public.plaid_items
  for each row execute function public.set_updated_at();

create table public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.plaid_items(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  plaid_account_id text not null unique,
  name text not null,
  official_name text,
  mask text,
  type text not null check (type in ('depository','credit','loan','investment','other')),
  subtype text,
  current_balance_cents bigint,
  available_balance_cents bigint,
  iso_currency_code text default 'USD',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plaid_accounts_item_idx on public.plaid_accounts(item_id);
create index plaid_accounts_entity_idx on public.plaid_accounts(entity_id);

create trigger plaid_accounts_set_updated_at
  before update on public.plaid_accounts
  for each row execute function public.set_updated_at();

-- RLS
alter table public.plaid_items enable row level security;
alter table public.plaid_accounts enable row level security;

create policy plaid_items_select on public.plaid_items
  for select to authenticated
  using (entity_id = any(public.current_user_entity_ids()));

create policy plaid_accounts_select on public.plaid_accounts
  for select to authenticated
  using (entity_id = any(public.current_user_entity_ids()));

-- No INSERT/UPDATE/DELETE policies — all writes go through SECURITY DEFINER server actions.
