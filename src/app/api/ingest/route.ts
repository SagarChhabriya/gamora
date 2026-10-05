import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { RemoteSourceError, parseFile, parseRemoteSource, parseTextSource } from "@/lib/ingest/parse";
import { createIngestJob } from "@/lib/ingest/pipeline";
import { blockedTopic, writePrimer } from "@/lib/ingest/topic-primer";
import { scanForPromptInjection } from "@/lib/ingest/security";
import { resolveTopicCap } from "@/lib/ingest/topics";
import { supabaseRequest } from "@/lib/supabase/server";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { guardSource, removePassages } from "@/lib/security/prompt-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { reportError } from "@/lib/observability/sentry";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().max(1_000_000).optional(),
  url: z.string().url().optional(),
  // A learning topic or brief with no document: a primer is written from it (see topic-primer).
  topic: z.string().trim().min(3).max(1_500).optional(),
});

/** What the Studio needs to guide a URL source: the sites it may come from. Empty means any public site. */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const [{ config }, profiles] = await Promise.all([
    getActiveConfig(),
    supabaseRequest<Array<{ topic_cap: number | null }>>(`profiles?id=eq.${auth.user.id}&select=topic_cap`).catch(() => null),
  ]);
  return NextResponse.json({ url_domains: config.content.url_domains, topic_cap: resolveTopicCap(profiles?.[0]?.topic_cap, config), topics_max: config.content.topics_max });
}

/** Creates an ingest job. The client then calls POST /api/ingest/<content_id>/step until complete. */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "upload");
  if (limited) return limited;

  try {
    let title: string;
    let text: string;
    let sourceType: string;
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      title = z.string().trim().min(1).max(200).parse(form.get("title"));
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("A source file is required");
      text = await parseFile(file);
      const name = file.name.toLowerCase();
      sourceType = name.endsWith(".pdf") ? "pdf" : name.endsWith(".docx") ? "docx" : "text";
    } else {
      const body = bodySchema.parse(await request.json());
      title = body.title;
      if (body.url) {
        const { config } = await getActiveConfig();
        text = await parseRemoteSource(body.url, config.content.url_domains);
        sourceType = "url";
      } else if (body.text) {
        text = await parseTextSource(body.text);
        sourceType = "text";
      } else if (body.topic) {
        const { config } = await getActiveConfig();
        const blocked = blockedTopic(`${body.title} ${body.topic}`, config.safety.blocked_topics);
        if (blocked) return NextResponse.json({ error: `Learning about "${blocked}" is turned off by the administrator.` }, { status: 422 });
        text = await writePrimer({ topic: body.title, brief: body.topic, requestId, userHash: auth.user.userHash });
        sourceType = "topic";
      } else {
        throw new Error("Provide a topic, text, a link or a file");
      }
    }

    const injectionFlags = scanForPromptInjection(text);
    if (injectionFlags.length) {
      await logEvent({
        request_id: requestId,
        user_hash: auth.user.userHash,
        type: "ingest.injection_blocked",
        ok: false,
        payload: { flags: injectionFlags },
      });
      return NextResponse.json(
        { error: "Source contains instruction-like text", injection_flags: injectionFlags },
        { status: 422 },
      );
    }

    const [{ config }, profiles] = await Promise.all([
      getActiveConfig(),
      supabaseRequest<Array<{ topic_cap: number | null }>>(`profiles?id=eq.${auth.user.id}&select=topic_cap`),
    ]);
    // Model check for instructions aimed at the AI. Standard strictness removes the flagged
    // passages and keeps the rest of the source; strict refuses the source.
    const guard = await guardSource(text, { requestId, userHash: auth.user.userHash });
    const cleaned = guard.flagged && config.safety.injection_strictness === "standard" ? removePassages(text, guard.evidence) : { text, removed: 0 };
    await logEvent({
      request_id: requestId,
      user_hash: auth.user.userHash,
      type: "ingest.guard",
      ok: guard.flagged === 0,
      payload: { checked: guard.checked, windows: guard.windows, flagged_windows: guard.flagged, removed: cleaned.removed, strictness: config.safety.injection_strictness },
    });
    if (guard.flagged && config.safety.injection_strictness === "strict") {
      return NextResponse.json({ error: "Source contains text addressed to the AI, so it was not added.", evidence: guard.evidence.slice(0, 3) }, { status: 422 });
    }
    text = cleaned.text;
    const warning = guard.flagged
      ? cleaned.removed
        ? `Removed ${cleaned.removed} ${cleaned.removed === 1 ? "passage" : "passages"} that gave instructions to the AI. The rest of the source is ready to learn from.`
        : "Parts of this source seem to address the AI. Gamora treats them as plain text and never follows them."
      : undefined;
    const topicCap = resolveTopicCap(profiles?.[0]?.topic_cap, config);
    const created = await createIngestJob({ ownerId: auth.user.id, title, sourceType, text, topicCap });
    await logEvent({
      request_id: requestId,
      user_hash: auth.user.userHash,
      type: "ingest.created",
      payload: { content_id: created.contentId, source_type: sourceType, language: created.language, chars: text.length },
    });
    return NextResponse.json(
      { content_id: created.contentId, language: created.language, job: created.job, duplicate: created.duplicate, warning },
      { status: created.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof RemoteSourceError) {
      // The site's answer, not our failure: tell the learner exactly what came back.
      await logEvent({
        request_id: requestId,
        user_hash: auth.user.userHash,
        type: "ingest.url_failed",
        ok: false,
        payload: { code: error.code, upstream_status: error.upstreamStatus ?? null },
      });
      return NextResponse.json({ error: error.message, code: error.code, upstream_status: error.upstreamStatus ?? null }, { status: 422 });
    }
    if (!(error instanceof z.ZodError)) reportError(error, { requestId, userHash: auth.user.userHash, area: "ingest.create" });
    const message =
      error instanceof z.ZodError ? "Invalid ingest request" : error instanceof Error ? error.message : "Ingestion failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
