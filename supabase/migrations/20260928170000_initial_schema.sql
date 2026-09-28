create extension if not exists pgcrypto;

DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('learner', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.content_status AS ENUM ('pending', 'processing', 'ready', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


DO $$ BEGIN
    CREATE TYPE public.session_mode AS ENUM ('voice', 'text');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'learner',
  display_name text,
  language_pref text not null default 'en',
  persona text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  source_type text not null,
  storage_path text,
  language text,
  status public.content_status not null default 'pending',
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete cascade,
  idx integer not null check (idx >= 0),
  text text not null,
  tokens integer check (tokens is null or tokens >= 0),
  tsv tsvector generated always as (to_tsvector('simple', text)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_id, idx)
);

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete cascade,
  name text not null,
  summary text not null,
  difficulty integer not null check (difficulty between 1 and 5),
  source_chunk_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.concept_edges (
  from_id uuid not null references public.concepts(id) on delete cascade,
  to_id uuid not null references public.concepts(id) on delete cascade,
  type text not null check (type in ('prerequisite', 'related')),
  primary key (from_id, to_id)
);

create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete cascade,
  config_version integer not null default 1,
  plan jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  idx integer not null check (idx >= 0),
  title text not null,
  story text not null,
  unlock_rule jsonb not null default '{}'::jsonb,
  unique (journey_id, idx)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles(id) on delete cascade,
  journey_id uuid not null references public.journeys(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  language text not null default 'en',
  mode public.session_mode not null default 'text'
);

create table public.turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  idx integer not null check (idx >= 0),
  role text not null check (role in ('assistant', 'learner', 'system')),
  activity_type text,
  content jsonb not null default '{}'::jsonb,
  source_chunk_ids uuid[] not null default '{}',
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  unique (session_id, idx)
);

create table public.evidence_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  signal text not null,
  value numeric not null,
  weight numeric not null,
  created_at timestamptz not null default now()
);

create table public.mastery (
  learner_id uuid not null references public.profiles(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  mastery numeric not null default 0 check (mastery between 0 and 1),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  last_seen timestamptz,
  primary key (learner_id, concept_id)
);

create table public.gamification (
  learner_id uuid primary key references public.profiles(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  streak integer not null default 0 check (streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  badges jsonb not null default '[]'::jsonb
);

create table public.configs (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  config jsonb not null,
  author_id uuid not null references public.profiles(id),
  note text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete cascade,
  step text not null default 'created',
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed')),
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  user_hash text,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  latency_ms integer,
  tokens_in integer,
  tokens_out integer,
  provider text,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

create index chunks_tsv_idx on public.chunks using gin (tsv);
create index evidence_events_learner_idx on public.evidence_events (learner_id, created_at desc);
create index events_type_created_idx on public.events (type, created_at desc);

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger contents_updated_at before update on public.contents for each row execute function public.set_updated_at();
create trigger chunks_updated_at before update on public.chunks for each row execute function public.set_updated_at();
create trigger concepts_updated_at before update on public.concepts for each row execute function public.set_updated_at();
create trigger journeys_updated_at before update on public.journeys for each row execute function public.set_updated_at();
create trigger configs_updated_at before update on public.configs for each row execute function public.set_updated_at();
create trigger ingest_jobs_updated_at before update on public.ingest_jobs for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.contents enable row level security;
alter table public.chunks enable row level security;
alter table public.concepts enable row level security;
alter table public.concept_edges enable row level security;
alter table public.journeys enable row level security;
alter table public.missions enable row level security;
alter table public.sessions enable row level security;
alter table public.turns enable row level security;
alter table public.evidence_events enable row level security;
alter table public.mastery enable row level security;
alter table public.gamification enable row level security;
alter table public.configs enable row level security;
alter table public.ingest_jobs enable row level security;
alter table public.events enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create policy profiles_read_own on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy contents_owner_or_admin on public.contents for all using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy chunks_content_owner_or_admin on public.chunks for all using (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin())));
create policy concepts_content_owner_or_admin on public.concepts for all using (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin())));
create policy concept_edges_content_owner_or_admin on public.concept_edges for all using (exists (select 1 from public.concepts c where c.id = from_id and (public.is_admin() or exists (select 1 from public.contents x where x.id = c.content_id and x.owner_id = auth.uid()))));
create policy journeys_content_owner_or_admin on public.journeys for all using (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin())));
create policy missions_journey_owner_or_admin on public.missions for all using (exists (select 1 from public.journeys j join public.contents c on c.id = j.content_id where j.id = journey_id and (c.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.journeys j join public.contents c on c.id = j.content_id where j.id = journey_id and (c.owner_id = auth.uid() or public.is_admin())));
create policy sessions_own_or_admin on public.sessions for all using (learner_id = auth.uid() or public.is_admin()) with check (learner_id = auth.uid() or public.is_admin());
create policy turns_session_owner_or_admin on public.turns for all using (exists (select 1 from public.sessions s where s.id = session_id and (s.learner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.sessions s where s.id = session_id and (s.learner_id = auth.uid() or public.is_admin())));
create policy evidence_own_or_admin on public.evidence_events for all using (learner_id = auth.uid() or public.is_admin()) with check (learner_id = auth.uid() or public.is_admin());
create policy mastery_own_or_admin on public.mastery for all using (learner_id = auth.uid() or public.is_admin()) with check (learner_id = auth.uid() or public.is_admin());
create policy gamification_own_or_admin on public.gamification for all using (learner_id = auth.uid() or public.is_admin()) with check (learner_id = auth.uid() or public.is_admin());
create policy configs_active_read on public.configs for select using (is_active or public.is_admin());
create policy configs_admin_write on public.configs for all using (public.is_admin()) with check (public.is_admin());
create policy ingest_jobs_owner_or_admin on public.ingest_jobs for all using (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.contents c where c.id = content_id and (c.owner_id = auth.uid() or public.is_admin())));

revoke all on public.events from anon, authenticated;
