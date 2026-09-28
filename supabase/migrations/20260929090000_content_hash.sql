-- Identical re-uploads reuse the existing source instead of creating duplicates.
alter table public.contents
  add column if not exists content_hash text;

create index if not exists contents_owner_hash_idx on public.contents (owner_id, content_hash);
