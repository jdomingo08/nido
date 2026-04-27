-- ─── Tables ────────────────────────────────────────────────

create table public.week_plans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  week_start_date date not null,
  generated_at timestamptz not null default now(),
  status text not null check (status in ('generating','ready','failed')) default 'ready',
  unique (family_id, week_start_date)
);

create index week_plans_family_idx on public.week_plans(family_id, week_start_date desc);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  week_plan_id uuid not null references public.week_plans(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  day text not null check (day in ('mon','tue','wed','thu','fri','sat','sun')),
  start_hour int not null check (start_hour >= 0 and start_hour <= 23),
  duration_min int not null check (duration_min > 0 and duration_min <= 240),
  kid_ids uuid[] not null default '{}',

  -- Activity content (denormalized; will normalize into a templates table when we
  -- introduce the cross-family library + retrieval layer in a later phase).
  title text not null,
  summary text,
  bucket text not null check (bucket in ('quiet','focus','deep','active','creative','social','outdoor','screen')),
  methodology text,
  age_min int,
  age_max int,
  prep_time_min int default 0,
  skills_developed text[] default '{}',
  materials jsonb default '[]'::jsonb,
  setup text,
  execution_steps jsonb default '[]'::jsonb,
  variations jsonb default '{}'::jsonb,
  troubleshooting text,
  cleanup text,
  safety_notes text,
  signs_it_worked text,
  weather_suitable text[] default array['sunny','rainy','cold'],

  status text not null check (status in ('proposed','approved','dismissed','completed','missed')) default 'proposed',
  badges text[] default '{}',
  reasoning text,
  weather_snapshot jsonb,
  scheduled_reminder_at timestamptz,
  completed_at timestamptz,
  completed_source text check (completed_source in ('auto','confirmed','manual')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index activities_week_plan_idx on public.activities(week_plan_id, day, start_hour);
create index activities_family_status_idx on public.activities(family_id, status);

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- LLM cost ledger
create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  purpose text not null,
  created_at timestamptz not null default now()
);

create index llm_calls_family_created_idx on public.llm_calls(family_id, created_at desc);

-- ─── RLS ───────────────────────────────────────────────────

alter table public.week_plans enable row level security;
alter table public.activities enable row level security;
alter table public.llm_calls enable row level security;

create policy week_plans_all on public.week_plans
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy activities_all on public.activities
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- llm_calls: read-only for the family; writes happen via the service-role client.
create policy llm_calls_select on public.llm_calls
  for select to authenticated
  using (family_id = public.current_family_id());
