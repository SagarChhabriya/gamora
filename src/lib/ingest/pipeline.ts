import { createHash } from "node:crypto";

import { getActiveConfig } from "@/lib/config/active";
import { chunkText, type SourceChunk } from "@/lib/ingest/chunk";
import { extractConcepts, linkConcepts } from "@/lib/ingest/concepts";
import { detectLanguage } from "@/lib/ingest/language";
import { carryMastery, groupIntoTopics, resolveTopicCap, unitsFromConcepts, type ConceptRow, type MasteryRowIn } from "@/lib/ingest/topics";
import { logEvent } from "@/lib/observability/events";
import { supabaseRequest } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/sentry";

export const ingestSteps = ["chunk", "concepts", "group", "link", "complete"] as const;
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
  payload: {
    text?: string;
    batch?: number;
    batches?: number;
    /** Most topics this source may have. Set when the job is created. */
    topic_cap?: number;
    /** A re-group of a source learners may already use: old rows are retired, not deleted. */
    regroup?: boolean;
    /** Concept rows the group step started from, so a retry can undo a half-finished attempt. */
    group_from?: string[];
    /** Topic rows the group step saved. Present means only the clean-up is left. */
    group_into?: string[];
  };
};

type Context = { requestId: string; userHash: string; skipProviders?: string[] };

const jobColumns = "id,content_id,owner_id,step,status,error,attempts,progress,payload";

export async function createIngestJob(input: {
  ownerId: string;
  title: string;
  sourceType: string;
  text: string;
  topicCap?: number;
}) {
  const language = detectLanguage(input.text);
  const contentHash = createHash("sha256").update(input.text.replace(/\s+/g, " ").trim()).digest("hex");

  // Same owner, same text: reuse the existing source rather than creating a duplicate.
  const existing = await supabaseRequest<Array<{ id: string; language: string | null }>>(
    `contents?owner_id=eq.${input.ownerId}&content_hash=eq.${contentHash}&status=in.(ready,processing)&select=id,language&order=created_at.desc&limit=1`,
  );
  if (existing?.[0]) {
    const job = await getJobForContent(existing[0].id);
    if (job) return { contentId: existing[0].id, language: existing[0].language ?? language, job: publicJob(job), duplicate: true };
  }

  const contents = await supabaseRequest<Array<{ id: string }>>("contents", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: input.ownerId,
      title: input.title,
      source_type: input.sourceType,
      status: "processing",
      language,
      content_hash: contentHash,
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
      payload: { text: input.text, topic_cap: input.topicCap },
    }),
  });
  const job = jobs?.[0];
  if (!job) throw new Error("Supabase did not return an ingest job");
  return { contentId, language, job: publicJob(job), duplicate: false };
}

/**
 * Re-groups a ready source under a new topic limit. It starts at the group step, so the file is not
 * read again. Journeys already planned keep their topics; new journeys use the new ones.
 */
export async function createRegroupJob(input: { contentId: string; ownerId: string; topicCap: number }) {
  await supabaseRequest(`contents?id=eq.${input.contentId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "processing" }),
  });
  const jobs = await supabaseRequest<IngestJob[]>(`ingest_jobs?select=${jobColumns}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      content_id: input.contentId,
      owner_id: input.ownerId,
      step: "group",
      status: "pending",
      progress: 80,
      payload: { topic_cap: input.topicCap, regroup: true },
    }),
  });
  const job = jobs?.[0];
  if (!job) throw new Error("Supabase did not return a re-group job");
  return publicJob(job);
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
  return { step: "concepts" as const, payload: { batch: 0, batches, topic_cap: job.payload.topic_cap }, progress: 25 };
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
  const payload = { batch: next, batches, topic_cap: job.payload.topic_cap };
  if (next < batches) return { step: "concepts" as const, payload, progress };
  return { step: "group" as const, payload, progress: 85 };
}

const ID_BATCH = 80;

/** Runs a request per slice of ids, so a long id list never makes an oversized URL. */
async function forIdBatches(ids: string[], run: (slice: string[]) => Promise<unknown>) {
  for (let start = 0; start < ids.length; start += ID_BATCH) await run(ids.slice(start, start + ID_BATCH));
}

/**
 * Groups the source into at most topic_cap topics. A fresh upload replaces its fine concepts with
 * the topics, since nothing uses them yet. A re-group retires the old rows instead, because
 * journeys already planned point at them, and carries each learner's progress to the new topics.
 */
async function stepGroup(job: IngestJob, context: Context) {
  const cap = job.payload.topic_cap ?? resolveTopicCap(null, (await getActiveConfig()).config);
  let rows =
    (await supabaseRequest<ConceptRow[]>(
      `concepts?content_id=eq.${job.content_id}&retired_at=is.null&select=id,name,summary,difficulty,source_chunk_ids,key_points&order=created_at.asc`,
    )) ?? [];
  let from = job.payload.group_from;
  if (from && job.payload.group_into) {
    // A retry after the topics were saved: only the clean-up of the old rows is left.
    const leftover = rows.filter((row) => from?.includes(row.id)).map((row) => row.id);
    await forIdBatches(leftover, (slice) =>
      job.payload.regroup
        ? supabaseRequest(`concepts?id=in.(${slice.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ retired_at: new Date().toISOString() }) })
        : supabaseRequest(`concepts?id=in.(${slice.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
    );
    return { step: "link" as const, payload: { batch: job.payload.batch, batches: job.payload.batches, topic_cap: cap, regroup: job.payload.regroup }, progress: 92 };
  }
  if (from) {
    // A retry: topics a failed attempt inserted are not in the starting list, so remove them.
    const started = new Set(from);
    const stray = rows.filter((row) => !started.has(row.id)).map((row) => row.id);
    await forIdBatches(stray, (slice) => supabaseRequest(`concepts?id=in.(${slice.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } }));
    rows = rows.filter((row) => started.has(row.id));
  } else {
    from = rows.map((row) => row.id);
    await updateJob(job.id, { payload: { ...job.payload, group_from: from } });
  }

  const units = unitsFromConcepts(rows);
  const alreadyFits = rows.every((row) => !row.key_points?.length) && units.length <= cap;
  let grouper = "none";
  if (!alreadyFits && units.length) {
    const grouped = await groupIntoTopics(units, cap, context);
    grouper = grouped.grouper;
    const inserted =
      (await supabaseRequest<Array<{ id: string }>>("concepts?select=id", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(
          grouped.topics.map((topic) => ({
            content_id: job.content_id,
            name: topic.name,
            summary: topic.summary,
            difficulty: topic.difficulty,
            source_chunk_ids: topic.source_chunk_ids,
            key_points: topic.key_points,
          })),
        ),
      })) ?? [];
    const oldIds = rows.map((row) => row.id);
    const saved = () => updateJob(job.id, { payload: { ...job.payload, group_from: from, group_into: inserted.map((row) => row.id) } });
    if (job.payload.regroup) {
      const mastery: MasteryRowIn[] = [];
      await forIdBatches(oldIds, async (slice) => {
        mastery.push(
          ...((await supabaseRequest<MasteryRowIn[]>(`mastery?concept_id=in.(${slice.join(",")})&select=learner_id,concept_id,mastery,confidence,evidence_count,last_seen`)) ?? []),
        );
      });
      const carried = grouped.topics.flatMap((topic, index) =>
        inserted[index] ? carryMastery(topic.members.map((unit) => unit.origin_id), mastery).map((row) => ({ ...row, concept_id: inserted[index].id })) : [],
      );
      if (carried.length) {
        await supabaseRequest("mastery?on_conflict=learner_id,concept_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(carried),
        });
      }
      await saved();
      const retiredAt = new Date().toISOString();
      await forIdBatches(oldIds, (slice) =>
        supabaseRequest(`concepts?id=in.(${slice.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ retired_at: retiredAt }) }),
      );
    } else {
      await saved();
      await forIdBatches(oldIds, (slice) => supabaseRequest(`concepts?id=in.(${slice.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } }));
    }
  }
  await supabaseRequest(`contents?id=eq.${job.content_id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ topic_cap: cap, grouped_at: new Date().toISOString() }),
  });
  await logEvent({
    request_id: context.requestId,
    user_hash: context.userHash,
    type: "ingest.grouped",
    payload: { content_id: job.content_id, units: units.length, cap, grouper, regroup: Boolean(job.payload.regroup) },
  });
  return { step: "link" as const, payload: { batch: job.payload.batch, batches: job.payload.batches, topic_cap: cap, regroup: job.payload.regroup }, progress: 92 };
}

async function stepLink(job: IngestJob, context: Context) {
  const concepts = await supabaseRequest<Array<{ id: string; name: string; summary: string }>>(
    `concepts?content_id=eq.${job.content_id}&retired_at=is.null&select=id,name,summary&order=created_at.asc`,
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
          : job.step === "group"
            ? await stepGroup(job, context)
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
