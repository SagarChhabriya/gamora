-- Topic cap: long sources are grouped into at most N topics. Each topic keeps the finer concepts
-- it absorbed as key points, so nothing from the source is lost.

alter table public.concepts
  add column if not exists key_points jsonb not null default '[]'::jsonb,
  -- Set when a re-group replaces this row. Journeys planned earlier keep using it; new ones do not.
  add column if not exists retired_at timestamptz;

create index if not exists concepts_active_idx on public.concepts (content_id) where retired_at is null;

alter table public.contents
  add column if not exists topic_cap integer check (topic_cap is null or topic_cap between 3 and 40),
  add column if not exists grouped_at timestamptz;

-- The learner's own limit. Null means the admin default applies.
alter table public.profiles
  add column if not exists topic_cap integer check (topic_cap is null or topic_cap between 3 and 40);
