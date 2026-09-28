import { chunkText, type SourceChunk } from "@/lib/ingest/chunk";
import { extractConcepts, linkConcepts } from "@/lib/ingest/concepts";
import { detectLanguage } from "@/lib/ingest/language";
import { logEvent } from "@/lib/observability/events";
import { supabaseRequest } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/sentry";

export const ingestSteps = ["chunk", "concepts", "link", "complete"] as const;
export type IngestStep = (typeof ingestSteps)[number];

export const CHUNKS_PER_BATCH = 4;
const MAX_ATTEMPTS = 3;

export type IngestJob = {
  id: string;
  content_id: string;
  owner_id: string | null;
  step: IngestStep;
  status: "pending" | "running" | "complete" | "failed";
  error: string | null;
  attempts: number;
  progress: number;
  payload: { text?: string; batch?: number; batches?: number };
};

type Context = { requestId: string; userHash: string; skipProviders?: string[] };

const jobColumns = "id,content_id,owner_id,step,status,error,attempts,progress,payload";

export async function createIngestJob(input: {
  ownerId: string;
  title: string;
  sourceType: string;
  text: string;
}) {
  const language = detectLanguage(input.text);
  const contents = await supabaseRequest<Array<{ id: string }>>("contents", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: input.ownerId,
      title: input.title,
      source_type: input.sourceType,
      status: "processing",
      language,
    }),
  });
  const contentId = contents?.[0]?.id;
  if (!contentId) throw new Error("Supabase did not return a content ID");

  const jobs = await supabaseRequest<IngestJob[]>(`ingest_jobs?select=${jobColumns}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      content_id: contentId,
      owner_id: input.ownerId,
      step: "chunk",
      status: "pending",
      progress: 10,
      payload: { text: input.text },
    }),
  });
  const job = jobs?.[0];
  if (!job) throw new Error("Supabase did not return an ingest job");
  return { contentId, language, job: publicJob(job) };
}

export function publicJob(job: IngestJob) {
  return {
    id: job.id,
    content_id: job.content_id,
    step: job.step,
    status: job.status,
    progress: job.progress,
    error: job.error,
    batch: job.payload.batch ?? null,
    batches: job.payload.batches ?? null,
  };
}

export async function getJobForContent(contentId: string, ownerId?: string) {
  const ownerFilter = ownerId ? `&owner_id=eq.${encodeURIComponent(ownerId)}` : "";
  const jobs = await supabaseRequest<IngestJob[]>(
    `ingest_jobs?content_id=eq.${encodeURIComponent(contentId)}${ownerFilter}&select=${jobColumns}&order=created_at.desc&limit=1`,
  );
  return jobs?.[0] ?? null;
}

async function updateJob(id: string, patch: Partial<IngestJob>) {
  await supabaseRequest(`ingest_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

async function loadChunks(contentId: string): Promise<Array<SourceChunk & { id: string }>> {
  const rows = await supabaseRequest<Array<{ id: string; idx: number; text: string; tokens: number | null }>>(
    `chunks?content_id=eq.${encodeURIComponent(contentId)}&select=id,idx,text,tokens&order=idx.asc`,
  );
  return (rows ?? []).map((row) => ({ id: row.id, index: row.idx, text: row.text, tokens: row.tokens ?? 0 }));
}

async function stepChunk(job: IngestJob) {
  const text = job.payload.text ?? "";
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("Source produced no chunks");
  // Upsert on (content_id, idx) keeps the step idempotent on retry.
  await supabaseRequest("chunks?on_conflict=content_id,idx", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(chunks.map((chunk) => ({ content_id: job.content_id, idx: chunk.index, text: chunk.text, tokens: chunk.tokens }))),
  });
  await supabaseRequest(`contents?id=eq.${job.content_id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ chunk_count: chunks.length }),
  });
  const batches = Math.ceil(chunks.length / CHUNKS_PER_BATCH);
  // Raw text is no longer needed once chunks exist. Data minimization.
  return { step: "concepts" as const, payload: { batch: 0, batches }, progress: 25 };
}

async function stepConcepts(job: IngestJob, context: Context) {
  const chunks = await loadChunks(job.content_id);
  const batch = job.payload.batch ?? 0;
  const batches = job.payload.batches ?? Math.ceil(chunks.length / CHUNKS_PER_BATCH);
  const slice = chunks.slice(batch * CHUNKS_PER_BATCH, (batch + 1) * CHUNKS_PER_BATCH);
  const ids = new Map(slice.map((chunk) => [chunk.index, chunk.id]));

  if (slice.length) {
    // Remove concepts from an earlier failed attempt at this batch, so retries do not duplicate.
    await supabaseRequest(
      `concepts?content_id=eq.${job.content_id}&source_chunk_ids=ov.{${[...ids.values()].join(",")}}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
    const plan = await extractConcepts(slice, context);
    const rows = plan.concepts.map((concept) => ({
      content_id: job.content_id,
      name: concept.name,
      summary: concept.summary,
      difficulty: concept.difficulty,
      source_chunk_ids: concept.source_chunk_indexes.map((index) => ids.get(index)).filter(Boolean),
    }));
    const inserted = rows.length
      ? await supabaseRequest<Array<{ id: string }>>("concepts", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(rows),
        })
      : [];
    const conceptIds = (inserted ?? []).map((row) => row.id);
    const edges = plan.edges
      .map((edge) => ({ from_id: conceptIds[edge.from], to_id: conceptIds[edge.to], type: edge.type }))
      .filter((edge) => edge.from_id && edge.to_id);
    if (edges.length) {
      await supabaseRequest("concept_edges?on_conflict=from_id,to_id", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(edges),
      });
    }
  }

  const next = batch + 1;
  const progress = 25 + Math.round((next / Math.max(1, batches)) * 60);
  if (next < batches) return { step: "concepts" as const, payload: { batch: next, batches }, progress };
  return { step: "link" as const, payload: { batch: next, batches }, progress: 85 };
}

async function stepLink(job: IngestJob, context: Context) {
  const concepts = await supabaseRequest<Array<{ id: string; name: string; summary: string }>>(
    `concepts?content_id=eq.${job.content_id}&select=id,name,summary&order=created_at.asc`,
  );
  const list = concepts ?? [];
  const edges = (await linkConcepts(list, context))
    .map((edge) => ({ from_id: list[edge.from]?.id, to_id: list[edge.to]?.id, type: edge.type }))
    .filter((edge) => edge.from_id && edge.to_id);
  if (edges.length) {
    await supabaseRequest("concept_edges?on_conflict=from_id,to_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(edges),
    });
  }
  await supabaseRequest(`contents?id=eq.${job.content_id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "ready" }),
  });
  return { step: "complete" as const, payload: { batch: job.payload.batch, batches: job.payload.batches }, progress: 100 };
}

/** Runs exactly one step. Each step fits well inside a serverless function limit and is safe to retry. */
export async function runIngestStep(job: IngestJob, context: Context) {
  if (job.status === "complete" || job.step === "complete") return publicJob(job);
  if (job.status === "failed") return publicJob(job);

  const started = Date.now();
  await updateJob(job.id, { status: "running", attempts: job.attempts + 1 });
  try {
    const result =
      job.step === "chunk"
        ? await stepChunk(job)
        : job.step === "concepts"
          ? await stepConcepts(job, context)
          : await stepLink(job, context);
    const done = result.step === "complete";
    const patch: Partial<IngestJob> = {
      step: result.step,
      payload: result.payload,
      progress: result.progress,
      status: done ? "complete" : "pending",
      attempts: 0,
      error: null,
    };
    await updateJob(job.id, patch);
    await logEvent({
      request_id: context.requestId,
      user_hash: context.userHash,
      type: `ingest.${job.step}`,
      latency_ms: Date.now() - started,
      payload: { content_id: job.content_id, next: result.step },
    });
    return publicJob({ ...job, ...patch } as IngestJob);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Ingest step failed";
    const failed = job.attempts + 1 >= MAX_ATTEMPTS;
    reportError(error, { requestId: context.requestId, userHash: context.userHash, area: `ingest.${job.step}`, extra: { content_id: job.content_id, attempt: job.attempts + 1 } });
    await updateJob(job.id, { status: failed ? "failed" : "pending", error: message, attempts: job.attempts + 1 });
    if (failed) {
      await supabaseRequest(`contents?id=eq.${job.content_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "failed" }),
      });
    }
    await logEvent({
      request_id: context.requestId,
      user_hash: context.userHash,
      type: `ingest.${job.step}`,
      ok: false,
      latency_ms: Date.now() - started,
      payload: { content_id: job.content_id, error: message },
    });
    return publicJob({ ...job, status: failed ? "failed" : "pending", error: message, attempts: job.attempts + 1 });
  }
}
