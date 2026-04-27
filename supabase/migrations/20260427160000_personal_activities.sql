create table public.personal_activities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  family_member_id uuid references public.family_members(id) on delete set null,

  title text not null,
  category text not null check (
    category in ('work', 'exercise', 'meal', 'errand', 'family', 'personal', 'other')
  ),
  color text not null default 'electric',
  notes text,

  -- Half-hour granularity: 9.5 = 9:30am
  start_hour numeric(4, 2) not null check (start_hour >= 0 and start_hour < 24),
  duration_min int not null check (duration_min > 0 and duration_min <= 480),

  -- Recurrence
  is_recurring boolean not null default false,
  recurring_days text[] not null default '{}',

  -- One-off scheduling (used when is_recurring = false)
  week_start_date date,
  day text check (day is null or day in ('mon','tue','wed','thu','fri','sat','sun')),

  -- Recurrence active window
  active_from date,
  active_until date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint personal_activities_shape check (
    (
      is_recurring = true
      and cardinality(recurring_days) > 0
      and day is null
      and week_start_date is null
    )
    or
    (
      is_recurring = false
      and cardinality(recurring_days) = 0
      and day is not null
      and week_start_date is not null
    )
  ),
  constraint personal_activities_recurring_days_valid check (
    recurring_days <@ array['mon','tue','wed','thu','fri','sat','sun']
  )
);

create index personal_activities_family_idx on public.personal_activities(family_id);
create index personal_activities_recurring_idx on public.personal_activities(family_id, is_recurring);
create index personal_activities_week_idx on public.personal_activities(family_id, week_start_date);

create trigger personal_activities_set_updated_at
  before update on public.personal_activities
  for each row execute function public.set_updated_at();

alter table public.personal_activities enable row level security;

create policy personal_activities_all on public.personal_activities
  for all to authenticated
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
