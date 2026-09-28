// M2 exit check: 10 page PDF ingest timing and provider outage drill.
// Usage: node scripts/m2-check.mjs [baseUrl]
// Creates a temporary ops account, runs the checks, then deletes the account and its data.
import { randomUUID } from "node:crypto";

import { makePdf, wrap } from "./fixtures/make-pdf.mjs";
import { policySections } from "./fixtures/policy-text.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be set.
}

const base = process.argv[2] ?? "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase env is missing");

const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

function buildPdf() {
  const lines = policySections.flatMap(([heading, body]) => ["", heading, ...wrap(body)]);
  const perPage = Math.ceil(lines.length / 10);
  const pages = Array.from({ length: 10 }, (_, page) => [
    `Northwind Bank / Customer Due Diligence and Fraud Response Policy / Page ${page + 1} of 10`,
    "",
    ...lines.slice(page * perPage, (page + 1) * perPage),
  ]);
  return makePdf(pages);
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

const email = `ops-check-${randomUUID().slice(0, 8)}@example.com`;
const password = `Check-${randomUUID()}`;
let userId;

try {
  const signup = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: "Ops check" }),
  });
  const session = await json(signup);
  if (!session.access_token) throw new Error(`Signup failed: ${JSON.stringify(session)}`);
  userId = session.user.id;
  const auth = { Authorization: `Bearer ${session.access_token}` };
  console.log(`signup ok, role=${session.user.role}`);

  // 1. Ten page PDF ingest, timed from upload to complete.
  const pdf = buildPdf();
  const form = new FormData();
  form.set("title", "Northwind CDD and Fraud Policy (timing check)");
  form.set("file", new Blob([pdf], { type: "application/pdf" }), "northwind-policy.pdf");
  const started = Date.now();
  const created = await json(await fetch(`${base}/api/ingest`, { method: "POST", headers: auth, body: form }));
  if (!created.content_id) throw new Error(`Ingest create failed: ${JSON.stringify(created)}`);
  console.log(`created content ${created.content_id} (language ${created.language}) in ${Date.now() - started} ms`);

  let job = created.job;
  while (job.status !== "complete" && job.status !== "failed") {
    const stepStarted = Date.now();
    const result = await json(await fetch(`${base}/api/ingest/${created.content_id}/step`, { method: "POST", headers: auth }));
    job = result.job ?? { status: "failed", error: JSON.stringify(result) };
    console.log(`  step -> ${job.step} ${job.status} ${job.progress ?? ""}% (${Date.now() - stepStarted} ms)${job.error ? ` error: ${job.error}` : ""}`);
  }
  const total = Date.now() - started;
  const detail = await json(await fetch(`${base}/api/ingest/${created.content_id}`, { headers: auth }));
  console.log(`INGEST ${job.status}: ${detail.chunks?.length} chunks, ${detail.concepts?.length} concepts, ${detail.edges?.length} edges in ${(total / 1000).toFixed(1)} s (target < 45 s)`);
  for (const concept of detail.concepts ?? []) console.log(`  - ${concept.name} (L${concept.difficulty}, ${concept.source_chunk_ids.length} sources)`);

  // 2. Outage drill. Promote the temporary account to admin for this check only.
  await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, { method: "PATCH", headers: admin, body: JSON.stringify({ role: "admin" }) });
  for (const simulate of [false, true]) {
    const drill = await json(
      await fetch(`${base}/api/admin/llm-check`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ simulate_primary_outage: simulate }),
      }),
    );
    console.log(`DRILL simulate_primary_outage=${simulate}: ${JSON.stringify(drill)}`);
  }
} finally {
  if (userId) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: admin });
    console.log("temporary account deleted");
  }
}
