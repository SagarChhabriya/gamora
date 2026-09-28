-- Streak tracking and counters for badges. Mission completion time on sessions.
alter table public.gamification
  add column if not exists last_active_on date,
  add column if not exists stats jsonb not null default '{}'::jsonb;

alter table public.sessions
  add column if not exists completed_at timestamptz;

create index if not exists sessions_mission_idx on public.sessions (mission_id, learner_id);
create index if not exists evidence_concept_idx on public.evidence_events (concept_id, created_at desc);
