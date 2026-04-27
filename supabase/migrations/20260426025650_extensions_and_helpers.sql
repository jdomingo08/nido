-- Enable required extensions.
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Reusable trigger function: bumps updated_at on row update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
