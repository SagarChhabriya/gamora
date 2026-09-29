# Supabase: useful queries

Run these in the Supabase dashboard under **SQL Editor** (project `qiicllnsbnpjrubazyof`). The SQL editor runs as the database owner, so row-level security does not hide anything here. Every query below is read-only except the ones under "Maintenance", which are marked.

Tip: replace values in angle brackets such as `<content-id>` before running.

---

## 1. Overview

**How much is in the system**

```sql
select
  (select count(*) from profiles)                              as users,
  (select count(*) from profiles where role = 'admin')         as admins,
  (select count(*) from contents)                              as sources,
  (select count(*) from concepts where retired_at is null)     as active_topics,
  (select count(*) from journeys)                              as journeys,
  (select count(*) from sessions)                              as mission_sessions,
  (select count(*) from sessions where completed_at is not null) as missions_completed,
  (select count(*) from turns)                                 as conversation_turns;
```

**Activity per day over the last 14 days**

```sql
select date_trunc('day', started_at)::date as day,
       count(*)                                    as sessions_started,
       count(*) filter (where completed_at is not null) as missions_completed,
       count(distinct learner_id)                  as active_learners
from sessions
where started_at > now() - interval '14 days'
group by 1
order by 1 desc;
```

---

## 2. Sources, passages and topics

**Latest sources with their size and topic limit**

```sql
select c.title, c.source_type, c.status, c.language, c.chunk_count as passages,
       c.topic_cap, c.grouped_at,
       count(t.id) filter (where t.retired_at is null)     as active_topics,
       count(t.id) filter (where t.retired_at is not null) as retired_topics,
       c.created_at
from contents c
left join concepts t on t.content_id = c.id
group by c.id
order by c.created_at desc
limit 20;
```

**The topics of one source, with their key points**

```sql
select name, difficulty,
       jsonb_array_length(key_points)       as key_points,
       array_length(source_chunk_ids, 1)    as passages,
       left(summary, 120)                   as summary
from concepts
where content_id = '<content-id>' and retired_at is null
order by created_at;
```

**Key point names inside one topic**

```sql
select t.name as topic, kp->>'name' as key_point
from concepts t, jsonb_array_elements(t.key_points) kp
where t.content_id = '<content-id>' and t.retired_at is null
order by t.created_at;
```

**Sources whose topics were never grouped (added before the topic limit existed)**

```sql
select c.title, count(t.id) as topics
from contents c
join concepts t on t.content_id = c.id and t.retired_at is null
where c.grouped_at is null
group by c.id
order by topics desc;
```

**Search the passages of a source (the same full-text search the tutor uses)**

```sql
select idx + 1 as passage, left(text, 200) as excerpt
from chunks
where content_id = '<content-id>'
  and tsv @@ websearch_to_tsquery('simple', 'gradient descent')
order by idx
limit 10;
```

**Ingestion jobs that are stuck or failed**

```sql
select j.step, j.status, j.attempts, j.progress, left(j.error, 120) as error, c.title, j.updated_at
from ingest_jobs j
join contents c on c.id = j.content_id
where j.status in ('failed', 'running', 'pending')
  and j.updated_at < now() - interval '10 minutes'
order by j.updated_at desc;
```

---

## 3. Learners, journeys and missions

**Journeys with their route and progress**

```sql
select p.display_name, j.title, j.plan->>'route' as route, j.language,
       count(distinct m.id) as missions,
       count(distinct s.mission_id) filter (where s.completed_at is not null) as missions_done,
       (j.plan ? 'storyboard') as has_storyboard,
       j.created_at
from journeys j
join profiles p on p.id = j.learner_id
left join missions m on m.journey_id = j.id
left join sessions s on s.journey_id = j.id and s.learner_id = j.learner_id
group by j.id, p.display_name
order by j.created_at desc
limit 20;
```

**Mastery per learner and topic**

```sql
select p.display_name, t.name as topic,
       round(m.mastery * 100) as mastery_pct,
       round(m.confidence * 100) as confidence_pct,
       m.evidence_count, m.last_seen
from mastery m
join profiles p on p.id = m.learner_id
join concepts t on t.id = m.concept_id
order by p.display_name, m.mastery desc;
```

**Learners stuck below the unlock threshold after a finished mission**

```sql
with threshold as (
  select (config->'mastery'->>'unlock_threshold')::numeric as unlock
  from configs where is_active
)
select p.display_name, mi.title as mission,
       round(avg(coalesce(ma.mastery, 0)) * 100) as mission_mastery_pct,
       round((select unlock from threshold) * 100) as unlock_pct
from sessions s
join missions mi on mi.id = s.mission_id
join profiles p on p.id = s.learner_id
cross join lateral unnest(mi.concept_ids) as cid
left join mastery ma on ma.learner_id = s.learner_id and ma.concept_id = cid
where s.completed_at is not null
group by p.display_name, mi.id, mi.title
having avg(coalesce(ma.mastery, 0)) < (select unlock from threshold)
order by mission_mastery_pct;
```

**How evidence is distributed (what learners are showing)**

```sql
select signal, count(*) as times, round(avg(value), 2) as avg_strength
from evidence_events
where created_at > now() - interval '30 days'
group by signal
order by times desc;
```

**XP, streaks and badges**

```sql
select p.display_name, g.xp, g.streak, g.best_streak,
       jsonb_array_length(g.badges) as badge_count, g.badges
from gamification g
join profiles p on p.id = g.learner_id
order by g.xp desc;
```

**Activity types used in missions**

```sql
select a->>'type' as activity_type, count(*) as planned
from missions, jsonb_array_elements(activities) a
group by 1
order by 2 desc;
```

---

## 4. AI usage, speed and reliability

All model calls are logged in `events` with `type = 'llm.call'`.

**Success rate and latency by provider and model (last 24 hours)**

```sql
select provider, payload->>'model' as model,
       count(*) as calls,
       round(100.0 * count(*) filter (where ok) / count(*)) as success_pct,
       percentile_cont(0.5)  within group (order by latency_ms) filter (where ok) as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) filter (where ok) as p95_ms
from events
where type = 'llm.call' and created_at > now() - interval '24 hours'
group by 1, 2
order by calls desc;
```

**Why calls failed (429 rate limit, 413 too large, 503 overloaded)**

```sql
select provider,
       substring(payload->>'error' from '\((\d{3})\)') as http_status,
       payload->>'purpose' as purpose,
       count(*) as failures
from events
where type = 'llm.call' and not ok and created_at > now() - interval '24 hours'
group by 1, 2, 3
order by failures desc;
```

**Which contributor key is doing the work**

```sql
select provider, payload->>'key' as key_owner,
       count(*) filter (where ok) as served,
       count(*) filter (where not ok) as refused
from events
where type = 'llm.call' and created_at > now() - interval '24 hours'
group by 1, 2
order by 1, served desc;
```

**Rate limits per hour (to see when the free tier runs out)**

```sql
select date_trunc('hour', created_at) as hour,
       count(*) filter (where payload->>'error' like '%(429)%') as rate_limited,
       count(*) filter (where ok) as served
from events
where type = 'llm.call' and created_at > now() - interval '48 hours'
group by 1
order by 1 desc;
```

**How often a backup provider answered**

```sql
select count(*) filter (where (payload->>'fallback_used')::boolean) as backup_answers,
       count(*) filter (where (payload->>'cached')::boolean)        as cache_hits,
       count(*)                                                      as successful_calls
from events
where type = 'llm.call' and ok and created_at > now() - interval '7 days';
```

**Tokens and estimated cost per day**

```sql
select date_trunc('day', created_at)::date as day,
       sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out,
       round(sum((payload->>'cost_usd')::numeric), 4) as est_cost_usd
from events
where type = 'llm.call' and ok and created_at > now() - interval '14 days'
group by 1
order by 1 desc;
```

**Slowest learner-facing requests**

```sql
select type, count(*) as requests,
       percentile_cont(0.5)  within group (order by latency_ms) as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
       max(latency_ms) as max_ms
from events
where type in ('turn.start', 'turn.answer', 'journey.created', 'storyboard.created', 'ingest.concepts', 'ingest.grouped')
  and created_at > now() - interval '7 days'
group by type
order by p95_ms desc nulls last;
```

---

## 5. Quality: grounding, adaptation and ratings

**Grounding verifier pass rate**

```sql
select count(*) as checks,
       round(100.0 * count(*) filter (where ok) / nullif(count(*), 0)) as pass_pct,
       (select count(*) from events where type = 'grounding.abstain' and created_at > now() - interval '7 days') as quoted_from_source
from events
where type = 'grounding.check' and created_at > now() - interval '7 days';
```

**Questions the material did not cover**

```sql
select count(*) as questions,
       count(*) filter (where (payload->>'abstained')::boolean) as not_in_material
from events
where type = 'tutor.ask' and created_at > now() - interval '30 days';
```

**Why the tutor adapted**

```sql
select reason, count(*) as times
from events, jsonb_array_elements_text(payload->'reasons') as reason
where type = 'adapt.decision' and created_at > now() - interval '30 days'
group by reason
order by times desc;
```

**Replies rated useful**

```sql
select payload->>'kind' as reply_kind,
       count(*) as ratings,
       round(100.0 * count(*) filter (where (payload->>'useful')::boolean) / count(*)) as useful_pct
from events
where type = 'reply.rated'
group by 1
order by ratings desc;
```

**Storyboards built, and how**

```sql
select payload->>'generator' as built_by, count(*) as storyboards,
       round(avg((payload->>'panels')::int), 1) as avg_panels,
       percentile_cont(0.5) within group (order by latency_ms) as p50_ms
from events
where type = 'storyboard.created'
group by 1;
```

**Recent errors**

```sql
select created_at, type, payload->>'route' as route, payload->>'action' as action, left(payload->>'message', 160) as message
from events
where (type = 'error' or (not ok and type <> 'llm.call'))
  and created_at > now() - interval '3 days'
order by created_at desc
limit 50;
```

---

## 6. Configuration

**The active configuration version**

```sql
select version, note, created_at,
       config->'mastery'    as mastery,
       config->'learner'    as learner,
       config->'difficulty' as difficulty,
       config->'mechanics'  as mechanics,
       config->'content'->'topics_default' as topics_default
from configs
where is_active;
```

**Configuration history**

```sql
select version, is_active, note, created_at
from configs
order by version desc;
```

---

## 7. Maintenance (these change data: read before running)

**Make a user an admin** (they need to sign out and in again)

```sql
update profiles set role = 'admin'
where id = (select id from auth.users where email = '<email>');
```

**Set a learner's own topic limit** (null means the admin default)

```sql
update profiles set topic_cap = 15
where id = (select id from auth.users where email = '<email>');
```

**Retry a failed ingestion job from the step it stopped at**

```sql
update ingest_jobs set status = 'pending', attempts = 0, error = null
where id = '<job-id>';
update contents set status = 'processing'
where id = (select content_id from ingest_jobs where id = '<job-id>');
```

**Delete old log events** (keeps the last 90 days)

```sql
delete from events where created_at < now() - interval '90 days';
```

**Remove topics retired by a re-group that no journey uses any more**

```sql
delete from concepts t
where t.retired_at is not null
  and not exists (select 1 from missions m where t.id = any (m.concept_ids));
```

Note on removing retired topics: this also deletes their mastery and evidence rows (cascade). Progress was already carried to the new topics at re-group time, so learners keep it, but dashboards lose the history of the old topics.
