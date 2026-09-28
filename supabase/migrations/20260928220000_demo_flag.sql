-- Synthetic demo learners are always labeled, so dashboards can separate them from real usage (ADR-006).
alter table public.profiles
  add column if not exists is_demo boolean not null default false;

create index if not exists events_created_idx on public.events (created_at desc);
