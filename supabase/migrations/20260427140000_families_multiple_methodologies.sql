-- Replace single `methodology` text with `methodologies` text[].
alter table public.families add column methodologies text[] not null default '{}';

-- Carry forward any existing single value.
update public.families
set methodologies = case
  when methodology is null or methodology = '' then '{}'::text[]
  else array[methodology]
end;

-- Drops the column and its check constraint.
alter table public.families drop column methodology;

-- Validate every element of the array is one of the supported methodologies.
alter table public.families add constraint families_methodologies_valid check (
  methodologies <@ array['montessori','reggio','waldorf','play-based','outdoor','stem','mixed']
);
