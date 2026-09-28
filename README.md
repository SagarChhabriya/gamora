## Gamora

Gamora is an AI learning experience engine. It turns any document into an adaptive, story-based learning journey, infers mastery from how people learn instead of testing them, and stays faithful to the source material.

Live: https://gamora-web.vercel.app

### What it does

- **Any content to experience.** Upload a PDF, DOCX, text, or URL. Ingestion runs as resumable steps: parse, injection scan, chunk, concept extraction, and a prerequisite graph.
- **Journeys, not quizzes.** A planner turns the concept graph into story missions sized to the learner's time and role, with eight activity types: explain-and-ask, scenario decisions, spot-the-error, ordering, role-play, teach-back, spaced recall, and reflection.
- **Real-time adaptation.** A rule-based policy (`src/lib/tutor/policy.ts`) adjusts difficulty, pace, modality, and language from learner signals. Every change is shown to the learner as a "Why this changed" note.
- **Assessment without tests.** Evidence from correctness, hints, self-correction, transfer, recall, and confidence calibration updates a per-concept mastery estimate with forgetting decay. Missions unlock on demonstrated mastery.
- **Grounded.** Activities cite source chunks and pass a verifier. Failed checks regenerate once, then fall back to quoting the source. Questions outside the material are declined.
- **Voice and access.** English and Roman Urdu with code-switching, Web Speech input with a Whisper fallback, read-aloud, text-only mode, high contrast, keyboard navigation, reduced motion.
- **Admin control.** A versioned, validated configuration (tone, language, difficulty range, mechanics, thresholds, grounding rules) applies on the next turn without a redeploy. Rollback is one click.
- **Dashboards and reports.** Overview, mastery heatmap, engagement funnel, friction, adaptation, usage and performance, grounding health, CSV export for every table, and a printable outcome report. Learners are pseudonymised by default.

### Stack

Next.js (App Router, route handlers only) and TypeScript, Tailwind, Supabase (Postgres, Auth, RLS on every table), Upstash Redis (rate limits, LLM cache, prefetch), Sentry (errors and traces, tagged with release and request ID, no PII), Groq and Gemini behind a provider interface with timeout, retry, model fallback, and provider fallback. Deployed on Vercel and Supabase free tiers.

```
src/app/api        route handlers (ingest, journeys, tutor/turn, voice, admin, auth)
src/lib/ingest     parse, chunk, concepts, language detection, job pipeline
src/lib/planner    journey planner
src/lib/tutor      activity generation, evaluation, policy, turn engine
src/lib/learner-model  mastery estimate
src/lib/grounding  verifier and grounded answers
src/lib/llm        providers, router, cache
src/lib/analytics  dashboard computations
supabase/migrations  SQL, RLS in the same migration as each table
```

### Requirements

- Node.js 22, pnpm 10
- A Supabase project, Groq and Gemini API keys, Upstash Redis

### Local setup

```bash
pnpm install
cp .env.example .env.local   # fill in the values
supabase db push             # apply migrations
pnpm dev
```

Seed the demo (panel accounts, two shared sources, and a synthetic cohort of 20 learners flagged as demo data):

```bash
node scripts/seed-demo.mjs http://localhost:3000
```

### Quality checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:eval        # grounding rate, abstain behaviour, adaptation traces (calls the LLM providers)
pnpm test:e2e         # browser smoke test
node scripts/m2-check.mjs   # 10 page PDF ingest timing and provider outage drill
node scripts/m3-check.mjs   # end-to-end learner flow through the API
```

### Security and privacy

Server-side auth and role checks on every route, RLS on every table, Zod validation on every input, rate limits per policy, SSRF protection for URL ingest, magic-byte file checks, prompt-injection scanning with delimited untrusted content, CSP and HSTS headers, spreadsheet formula neutralisation in exports, hashed user IDs in logs, no audio storage, and a delete-my-data endpoint.

### Honest limits

Mastery is an explainable weighted-evidence estimate, not a psychometrically validated score. Roman Urdu output quality depends on the free models available and is best reviewed by a native speaker. Free-tier model rate limits apply; the router waits out short limits and falls back across models and providers.
