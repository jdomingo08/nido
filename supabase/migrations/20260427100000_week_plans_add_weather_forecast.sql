alter table public.week_plans
  add column if not exists weather_forecast jsonb;
