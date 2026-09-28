-- M3: sources can be shared by admins, journeys belong to a learner, sessions keep tutor state.

alter table public.contents
  add column if not exists shared boolean not null default false;

alter table public.profiles
  add column if not exists onboarding jsonb not null default '{}'::jsonb,
  add column if not exists time_budget_min integer not null default 15 check (time_budget_min between 3 and 240);

alter table public.journeys
  add column if not exists learner_id uuid references public.profiles(id) on delete cascade,
  add column if not exists title text,
  add column if not exists language text not null default 'en',
  add column if not exists persona text;

create index if not exists journeys_learner_idx on public.journeys (learner_id, created_at desc);

alter table public.missions
  add column if not exists concept_ids uuid[] not null default '{}',
  add column if not exists activities jsonb not null default '[]'::jsonb;

alter table public.sessions
  add column if not exists mission_id uuid references public.missions(id) on delete set null,
  add column if not exists state jsonb not null default '{}'::jsonb,
  add column if not exists persona text;

create index if not exists sessions_learner_idx on public.sessions (learner_id, started_at desc);
create index if not exists turns_session_idx on public.turns (session_id, idx);
create index if not exists mastery_concept_idx on public.mastery (concept_id);

-- Learners may read shared sources and their chunks and concepts.
create policy contents_shared_read on public.contents for select using (shared);
create policy chunks_shared_read on public.chunks for select using (
  exists (select 1 from public.contents c where c.id = content_id and c.shared)
);
create policy concepts_shared_read on public.concepts for select using (
  exists (select 1 from public.contents c where c.id = content_id and c.shared)
);

-- Journeys and missions are private to the learner they were planned for.
drop policy if exists journeys_content_owner_or_admin on public.journeys;
create policy journeys_learner_or_admin on public.journeys for all
  using (learner_id = auth.uid() or public.is_admin())
  with check (learner_id = auth.uid() or public.is_admin());

drop policy if exists missions_journey_owner_or_admin on public.missions;
create policy missions_learner_or_admin on public.missions for all
  using (exists (select 1 from public.journeys j where j.id = journey_id and (j.learner_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.journeys j where j.id = journey_id and (j.learner_id = auth.uid() or public.is_admin())));
