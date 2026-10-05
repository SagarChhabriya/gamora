-- Re-engagement nudges and generated media.

-- A nudge invites a learner back to review topics that are fading. Written by the daily job and
-- by the home page; read by the learner. seen_at and acted_at measure whether nudges work.
create table if not exists public.nudges (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('review_due', 'streak_at_risk', 'welcome_back')),
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  acted_at timestamptz
);

create index if not exists nudges_learner_idx on public.nudges (learner_id, created_at desc);

alter table public.nudges enable row level security;
create policy nudges_own_or_admin on public.nudges for select using (learner_id = auth.uid() or public.is_admin());

-- Generated images, one per prompt key, shared by every learner of a source. The file lives in
-- the private "media" bucket and is shown through short-lived signed URLs. cost_usd is the list
-- price at generation time, used for the monthly budget and the dashboard.
create table if not exists public.media_assets (
  key text primary key,
  content_id uuid references public.contents(id) on delete cascade,
  concept_id uuid references public.concepts(id) on delete set null,
  kind text not null default 'image' check (kind in ('image')),
  model text not null,
  storage_path text not null,
  mime_type text not null,
  bytes integer not null,
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists media_assets_content_idx on public.media_assets (content_id);
create index if not exists media_assets_created_idx on public.media_assets (created_at desc);

alter table public.media_assets enable row level security;
create policy media_assets_admin_read on public.media_assets for select using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
