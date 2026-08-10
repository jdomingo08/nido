-- =====================================================================
-- Nido · finance domain — starter migration
-- Review before applying. Adapt naming/FKs to Nido's existing conventions
-- (especially how `family_id` and membership are modelled today).
-- Money is numeric(12,2) everywhere. Dates are `date`, never timestamptz.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Accounts (Amex-style card, Robinhood card, cash, …)
-- Modelling this now avoids a painful migration when a 2nd card is added.
-- ---------------------------------------------------------------------
create table finance_accounts (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  name         text not null,
  kind         text not null default 'credit_card'
               check (kind in ('credit_card','bank','cash','investment')),
  currency     text not null default 'USD',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Transactions
-- `source`: 'import' rows come from a CSV and may be replaced on re-import.
--           'manual' rows exist nowhere in any export and MUST survive imports.
-- `dedupe_key`: makes re-importing an overlapping export idempotent.
-- amount: positive = money out (purchase); negative = money in (refund/credit).
-- ---------------------------------------------------------------------
create table finance_transactions (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  account_id    uuid references finance_accounts(id) on delete set null,

  txn_date      date not null,
  posted_time   text,
  cardholder    text,
  merchant      text not null,
  description   text,

  amount        numeric(12,2) not null,
  points        integer not null default 0,

  status        text not null default 'posted'
                check (status in ('posted','pending','declined','recurring')),
  txn_type      text not null default 'purchase'
                check (txn_type in ('purchase','refund','payment','other','fixed')),

  category_key  text not null default 'uncategorized',
  source        text not null default 'import'
                check (source in ('import','manual','fixed')),

  dedupe_key    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Idempotent re-import. Compute as
--   md5(txn_date || amount || lower(merchant) || status || txn_type)
create unique index finance_txn_dedupe
  on finance_transactions (family_id, dedupe_key);

create index finance_txn_family_date on finance_transactions (family_id, txn_date desc);
create index finance_txn_family_cat  on finance_transactions (family_id, category_key);

-- ---------------------------------------------------------------------
-- Category rules — family-editable, replaces the hardcoded engine constant.
-- Ordered: first match wins. Keep `priority` sparse (10,20,30…) so rules
-- can be inserted between existing ones without a rewrite.
-- IMPORTANT: more specific rules must sort before broader ones
--   ('uber eats' → dining) MUST come before ('uber' → transport).
-- ---------------------------------------------------------------------
create table finance_category_rules (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  match_text    text not null,            -- lowercase substring match
  category_key  text not null,
  priority      integer not null default 100,
  created_at    timestamptz not null default now()
);
create index finance_rules_family on finance_category_rules (family_id, priority);

-- Per-merchant manual overrides beat every rule.
create table finance_merchant_overrides (
  family_id     uuid not null references families(id) on delete cascade,
  merchant_key  text not null,            -- lower(trim(merchant))
  category_key  text not null,
  primary key (family_id, merchant_key)
);

-- ---------------------------------------------------------------------
-- Fixed monthly commitments (mortgage, HOA, utilities, subscriptions…)
-- `schedule`: { "2026-06": 285.00, "2026-07": 0 }
--   value present → use it;  0 → SKIP that month entirely (paused);
--   month absent  → fall back to `amount`.
-- ---------------------------------------------------------------------
create table finance_fixed_items (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  name          text not null,
  category_key  text not null,
  amount        numeric(12,2) not null,   -- base / fallback amount
  schedule      jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Income: paychecks, recurring monthly items, and one-off receipts.
-- kind='paycheck'  → uses pay_date, gross/taxes/deductions/net
-- kind='recurring' → applies to every active month, uses net
-- kind='one_off'   → applies to `month` only, uses net
-- ---------------------------------------------------------------------
create table finance_income (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,

  kind          text not null check (kind in ('paycheck','recurring','one_off')),
  bucket        text not null default 'other'
                check (bucket in ('salary','bonus','other','interest')),
  name          text,

  pay_date      date,                     -- paycheck
  month         text,                     -- one_off, 'YYYY-MM'

  gross         numeric(12,2),
  taxes         numeric(12,2),
  deductions    numeric(12,2),
  net           numeric(12,2) not null,

  is_estimate   boolean not null default false,   -- projected vs. verified stub
  created_at    timestamptz not null default now()
);
create index finance_income_family on finance_income (family_id, kind);

-- ---------------------------------------------------------------------
-- Settings: budgets per category, excluded one-off charges, preferences.
-- ---------------------------------------------------------------------
create table finance_settings (
  family_id     uuid primary key references families(id) on delete cascade,
  budgets       jsonb not null default '{}'::jsonb,  -- { category_key: amount }
  excluded_txns jsonb not null default '[]'::jsonb,  -- [dedupe_key, …]
  prefs         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

-- =====================================================================
-- ROW LEVEL SECURITY
-- Financial data. Get this right before writing a single query.
-- Assumes a helper that returns the families the current user belongs to;
-- replace `user_families()` with Nido's actual membership check.
-- =====================================================================

alter table finance_accounts            enable row level security;
alter table finance_transactions        enable row level security;
alter table finance_category_rules      enable row level security;
alter table finance_merchant_overrides  enable row level security;
alter table finance_fixed_items         enable row level security;
alter table finance_income              enable row level security;
alter table finance_settings            enable row level security;

-- Example helper — adapt to Nido's existing family membership model.
-- create or replace function user_families()
-- returns setof uuid language sql stable security definer as $$
--   select family_id from family_members where user_id = auth.uid()
-- $$;

do $$
declare t text;
begin
  foreach t in array array[
    'finance_accounts','finance_transactions','finance_category_rules',
    'finance_merchant_overrides','finance_fixed_items','finance_income','finance_settings'
  ] loop
    execute format($f$
      create policy %1$s_select on %1$I for select
        using (family_id in (select user_families()));
      create policy %1$s_insert on %1$I for insert
        with check (family_id in (select user_families()));
      create policy %1$s_update on %1$I for update
        using (family_id in (select user_families()))
        with check (family_id in (select user_families()));
      create policy %1$s_delete on %1$I for delete
        using (family_id in (select user_families()));
    $f$, t);
  end loop;
end $$;

-- REQUIRED TEST: seed two families, then assert as user A that
--   select count(*) from finance_transactions where family_id = <family B>
-- returns 0. Do not skip this.
