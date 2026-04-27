alter table public.activities
  add column if not exists inspiration_source text,
  add column if not exists inspiration_detail text;
