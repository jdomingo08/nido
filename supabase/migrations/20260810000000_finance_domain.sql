-- ─── Finance domain ────────────────────────────────────────
-- Adapted from docs/nido-finance-handoff/SCHEMA.sql to Nido's conventions
-- (public schema, current_family_id() RLS helper, set_updated_at trigger).
-- Money is numeric(12,2) everywhere. Transaction dates are `date`, never
-- timestamptz — a purchase on the 31st must not become the 30th in another
-- timezone.
--
-- Deliberate deviations from the handoff starter schema (see
-- docs/nido-finance-handoff/DECISIONS.md §9):
--   · dedupe_key is the plain composite string
--       date|amount|merchant_lower|status|type|occurrence
--     with a 0-based occurrence index appended: the fixture data contains
--     legitimately identical rows (two posted OpenAI $10.00 charges on
--     2026-03-15, plus three declined retry pairs) that a bare hash of the
--     documented fields would collapse.
--   · finance_category_rules gains match_type ('substring'|'exact') so the
--     reference engine's exact-merchant UPS rule lives in data, not code.
--   · finance_income gains source provenance ('stub'|'reconstructed'|
--     'projected'|'manual') and a detail jsonb — the paycheck provenance
--     badges and the verified-stub breakdown are required UI (VIEWS.md §2),
--     and the starter's is_estimate boolean loses both.
--   · status / txn_type keep the bank export's capitalized spellings so a
--     stored row round-trips through the engine byte-identically.
--   · transactions.source allows only 'import'|'manual' — fixed bills are
--     synthesized by the engine at read time and never persisted.

-- ─── Accounts ──────────────────────────────────────────────
-- Modelled from day one so adding the Robinhood card later isn't a painful
-- migration (DECISIONS.md §6 — it's the largest known accuracy gap).

create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  kind text not null default 'credit_card'
    check (kind in ('credit_card','bank','cash','investment')),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create index finance_accounts_family_id_idx on public.finance_accounts(family_id);

-- ─── Transactions ──────────────────────────────────────────
-- source='import' rows come from a CSV and may be superseded on re-import.
-- source='manual' rows exist in no bank export and MUST survive imports.
-- amount: positive = money out (purchase); negative = money in (refund).

create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  account_id uuid references public.finance_accounts(id) on delete set null,

  txn_date date not null,
  posted_time text,
  cardholder text,
  merchant text not null,
  description text,

  amount numeric(12,2) not null,
  points integer not null default 0,

  status text not null default 'Posted'
    check (status in ('Posted','Pending','Declined','Recurring')),
  txn_type text not null default 'Purchase'
    check (txn_type in ('Purchase','Refund','Payment','Other','Fee')),

  category_key text not null default 'uncategorized',
  source text not null default 'import'
    check (source in ('import','manual')),

  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent re-import: same file in, same keys, no duplicate rows out.
create unique index finance_transactions_dedupe_idx
  on public.finance_transactions(family_id, dedupe_key);

create index finance_transactions_family_date_idx
  on public.finance_transactions(family_id, txn_date desc);
create index finance_transactions_family_category_idx
  on public.finance_transactions(family_id, category_key);

create trigger finance_transactions_set_updated_at
  before update on public.finance_transactions
  for each row execute function public.set_updated_at();

-- ─── Category rules ────────────────────────────────────────
-- Family-editable; replaces the reference engine's hardcoded constant.
-- Ordered: first match wins. priority is kept sparse (10, 20, 30…) so rules
-- can be inserted between existing ones without a rewrite.
-- IMPORTANT: more specific rules must sort before broader ones —
-- ('uber eats' → dining_takeout) MUST come before ('uber' → transportation).

create table public.finance_category_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  match_text text not null,          -- lowercase; substring or exact merchant
  match_type text not null default 'substring'
    check (match_type in ('substring','exact')),
  category_key text not null,
  priority integer not null default 100,
  created_at timestamptz not null default now()
);

create index finance_category_rules_family_priority_idx
  on public.finance_category_rules(family_id, priority);

-- Per-merchant manual overrides beat every rule. Re-tagging a merchant in
-- the UI writes here and applies to ALL its transactions, past and future.
create table public.finance_merchant_overrides (
  family_id uuid not null references public.families(id) on delete cascade,
  merchant_key text not null,        -- lower(trim(merchant))
  category_key text not null,
  primary key (family_id, merchant_key)
);

-- ─── Fixed monthly commitments ─────────────────────────────
-- Mortgage, HOA, utilities… — never on the card; the engine injects one
-- synthetic transaction per active month at read time.
-- schedule semantics: { "2026-06": 285.00, "2026-07": 0 }
--   value present → use it;  0 → SKIP that month entirely (paused);
--   month absent  → fall back to `amount`.

create table public.finance_fixed_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  category_key text not null,
  amount numeric(12,2) not null,     -- base / fallback amount
  schedule jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index finance_fixed_items_family_id_idx on public.finance_fixed_items(family_id);

create trigger finance_fixed_items_set_updated_at
  before update on public.finance_fixed_items
  for each row execute function public.set_updated_at();

-- ─── Income ────────────────────────────────────────────────
-- kind='paycheck'  → uses pay_date + gross/taxes/deductions/net
-- kind='recurring' → applies to every active month, uses net
-- kind='one_off'   → applies to `month` only, uses net
-- source: 'stub' = verified against a real pay stub · 'reconstructed' =
-- derived from verified YTD totals · 'projected' = modelled, replace with
-- actuals · 'manual' = user-entered. Keep these visible — the provenance
-- badges tell the user which figures to trust (VIEWS.md §2).

create table public.finance_income (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,

  kind text not null check (kind in ('paycheck','recurring','one_off')),
  bucket text not null default 'other'
    check (bucket in ('salary','bonus','other','interest')),
  name text,

  pay_date date,                     -- paycheck
  period_start date,                 -- paycheck
  period_end date,                   -- paycheck
  month text,                        -- one_off, 'YYYY-MM'

  gross numeric(12,2),
  taxes numeric(12,2),
  deductions numeric(12,2),
  net numeric(12,2) not null,

  source text not null default 'manual'
    check (source in ('stub','reconstructed','projected','manual')),
  detail jsonb,                      -- stub line items (taxes, 401k, …)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index finance_income_family_kind_idx on public.finance_income(family_id, kind);

create trigger finance_income_set_updated_at
  before update on public.finance_income
  for each row execute function public.set_updated_at();

-- ─── Settings ──────────────────────────────────────────────
-- Budgets per category, excluded one-off charges, preferences — the state
-- the reference app kept in localStorage, now family-scoped (VIEWS.md).

create table public.finance_settings (
  family_id uuid primary key references public.families(id) on delete cascade,
  budgets jsonb not null default '{}'::jsonb,       -- { category_key: amount }
  excluded_txns jsonb not null default '[]'::jsonb, -- [dedupe_key, …]
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger finance_settings_set_updated_at
  before update on public.finance_settings
  for each row execute function public.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────
-- Financial data: policies before queries, always. current_family_id() is
-- SECURITY DEFINER and filters by auth.uid(), so it can only ever return the
-- caller's own family.

alter table public.finance_accounts enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_category_rules enable row level security;
alter table public.finance_merchant_overrides enable row level security;
alter table public.finance_fixed_items enable row level security;
alter table public.finance_income enable row level security;
alter table public.finance_settings enable row level security;

create policy finance_accounts_all on public.finance_accounts
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy finance_transactions_all on public.finance_transactions
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy finance_category_rules_all on public.finance_category_rules
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy finance_merchant_overrides_all on public.finance_merchant_overrides
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy finance_fixed_items_all on public.finance_fixed_items
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy finance_income_all on public.finance_income
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy finance_settings_all on public.finance_settings
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
