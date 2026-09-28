## Gamora

Gamora is a source-grounded, adaptive learning experience engine. It turns trusted material into conversational missions and evidence-based progress.

### Requirements

- Node.js 22
- pnpm 10
- Supabase project
- Groq and Gemini API keys
- Upstash Redis credentials

### Local setup

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Open http://localhost:3000. Fill `.env.local` with the service values before using API routes. Never commit `.env.local`, provider keys, or service-role keys.

### Validation

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the browser smoke test:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

### Ingestion API

`POST /api/ingest` requires a Supabase access token:

```http
Authorization: Bearer <access-token>
```

Text request:

```json
{
  "title": "Source title",
  "text": "Trusted source material"
}
```

The route also accepts `multipart/form-data` with `title` and `file`, or JSON with `title` and a safe HTTP(S) `url`. It stores chunks, concepts, and concept-edge links in Supabase.

Use `GET /api/ingest/<content_id>` with the same token to inspect stored chunks and concepts.

### Deployment

The current deployment uses the authenticated Vercel CLI:

```powershell
vercel --prod
```

Production alias: https://gamora-web.vercel.app

GitHub is optional for direct deployment. Connecting Git in Vercel enables automatic deployments from pushes.
