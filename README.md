## Gamora

Gamora is an AI learning experience engine. It turns any document into an adaptive, story-based learning journey, infers mastery from how people learn instead of testing them, and stays faithful to the source material.

Live: https://gamora-web.vercel.app

Documentation:
- [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md): the project in plain language and in technical depth (serverless architecture, request walkthroughs, stack and alternatives, data model, security).
- [docs/MASTERY.md](docs/MASTERY.md): how mastery is calculated, with worked examples.
- [docs/SUPABASE_QUERIES.md](docs/SUPABASE_QUERIES.md): ready-to-run SQL for usage, AI reliability, quality and maintenance.

### What it does

- **Any content to experience.** Upload a PDF, DOCX, text, or a link. Ingestion runs as resumable steps: parse, injection scan, split into passages, concept extraction, grouping into at most 12 topics (each learner can choose up to 30, and older sources can be re-grouped), and a prerequisite map.
- **Journeys, not quizzes.** The learner picks a route (Narrative, Scenarios, Quick scan or Focus). An illustrated storyboard previews the journey, one panel per topic, with quotes checked word for word. Missions teach first, then practise with explain-and-ask, scenario decisions, spot-the-error, ordering, role-play, teach-back, spaced recall and reflection, one Crossroads decision per mission whose outcome carries forward, and a closing Capstone case that needs several topics at once.
- **Many ways to see a lesson.** Notes and flow plus 13 diagram views (key figure, side by side, sequence, trend bars, share split, loop, guardrails, checkpoints, milestones, overlap, quadrant, cause chain, branch tree), offered only when the material has the data. Numbers and dates are shown only when the source states them.
- **Real-time adaptation.** A rule-based policy (`src/lib/tutor/policy.ts`) adjusts difficulty, pace, support and language from learner signals. Every change shows a "Why this changed" note, and a Tuning panel always shows the current settings. The starting challenge follows how familiar the learner says they are.
- **Assessment without tests.** Evidence from correctness, hints, self-correction, transfer, recall and confidence calibration updates a per-topic mastery estimate with forgetting. Two clean answers unlock the next mission; three master a topic. See [docs/MASTERY.md](docs/MASTERY.md).
- **Grounded.** Activities cite source passages and pass a verifier. Failed checks regenerate once, then fall back to quoting the source, labelled as such. Questions outside the material are declined.
- **Voice and access.** English and Roman Urdu with code-switching, Web Speech input with a Whisper fallback, read-aloud in a Pakistani or South Asian English voice when the device has one, a hands-free mode (reads each step, listens for next, hint, repeat, an option or an answer), text-only mode, high contrast, keyboard navigation, reduced motion, and a phone layout with a settings sheet.
- **Guided tour.** Fifteen steps across the real screens, offered to new learners and in the profile menu.
- **Honest when busy.** Free model tiers have per-minute limits. The router rests a rate-limited key and tries the next key, then the next provider, and the learner sees a short notice instead of silence.
- **Admin control.** A versioned, validated configuration (tone, language, difficulty range, mechanics, mastery thresholds, topic limits, storyboard, Capstone and Crossroads switches, grounding rules) applies on the next turn without a redeploy. Rollback is one click.
- **Dashboards and reports.** Overview, mastery heatmap, engagement funnel, friction, adaptation, usage and performance, grounding health, replies rated useful, CSV export for every table, and a printable outcome report. Learners are pseudonymised by default.

### Stack

Next.js 16 (App Router, route handlers only), React 19, TypeScript, Tailwind 4 and Zod. Supabase (Postgres, Auth, RLS on every table), Upstash Redis (rate limits, LLM cache, prefetch, locks), Sentry (errors and traces, tagged with release and request ID, no PII). Language models behind one router: Groq (gpt-oss 20b and 120b), then Gemini, then OpenRouter, with a pool of contributor keys, timeouts, model and provider fallback, and lenient parsing of replies that run long. Serverless on Vercel and Supabase free tiers.

```
src/app/api          route handlers (ingest, contents, journeys, storyboard, tutor, voice, admin, auth)
src/lib/ingest       parse, chunk, concepts, topic grouping, language detection, job pipeline
src/lib/planner      journey planner, routes, capstone
src/lib/storyboard   storyboard generation and grounding checks
src/lib/tutor        activity generation, evaluation, policy, session, turn engine
src/lib/visuals      diagram views and their data rules
src/lib/learner-model  mastery estimate
src/lib/grounding    verifier and grounded answers
src/lib/llm          providers, router, key pool, cache, busy notices
src/lib/voice        speech in and out, voice choice, hands-free commands
src/lib/analytics    dashboard computations
supabase/migrations  SQL, RLS in the same migration as each table
```

### Requirements

- Node.js 22, pnpm 10
- A Supabase project, Groq and Gemini API keys (OpenRouter optional), Upstash Redis

### Local setup

```bash
pnpm install
cp .env.example .env.local   # fill in the values
supabase db push             # apply migrations
pnpm dev
```

Seed the demo (panel accounts, two shared sources, and a synthetic cohort of 20 learners flagged as demo data):

```bash
node --env-file=.env.local scripts/seed-demo.mjs http://localhost:3000
```

### Quality checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:eval        # grounding rate, abstain behaviour, adaptation traces (calls the LLM providers)
pnpm test:e2e         # browser smoke test
node --env-file=.env.local scripts/m2-check.mjs <url>   # 10 page PDF ingest timing and provider outage drill
node --env-file=.env.local scripts/m3-check.mjs <url>   # end-to-end learner flow with a throwaway account
```

### Security and privacy

Server-side auth and role checks on every route, RLS on every table, Zod validation on every input, rate limits per policy, SSRF protection for URL ingest, magic-byte file checks, prompt-injection scanning with delimited untrusted content, CSP and HSTS headers, spreadsheet formula neutralisation in exports, hashed user IDs in logs, no audio storage, and a delete-my-data endpoint.

### Honest limits

Mastery is an explainable weighted-evidence estimate, not a psychometrically validated score. Roman Urdu output quality depends on the free models available and is best reviewed by a native speaker. Read-aloud uses the device's voices: a true Urdu voice is not used, because Gamora's text is in the Latin alphabet. Free-tier model rate limits add waiting at busy times; the router falls back across keys, models and providers and tells the learner when it does.
