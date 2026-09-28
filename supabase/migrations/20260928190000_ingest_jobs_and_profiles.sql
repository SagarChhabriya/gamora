-- Resumable ingest jobs: step payload and progress tracking.
alter table public.ingest_jobs
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists progress integer not null default 0 check (progress between 0 and 100),
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade;

create index if not exists ingest_jobs_content_idx on public.ingest_jobs (content_id);

-- Every new auth user gets a learner profile. Admin role is granted manually.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
