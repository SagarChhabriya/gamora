import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { createRegroupJob } from "@/lib/ingest/pipeline";
import { resolveTopicCap } from "@/lib/ingest/topics";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ contentId: string }> };

const bodySchema = z.object({ topic_cap: z.number().int().min(3).max(40).optional() });

/**
 * Re-groups a source the learner owns under a new topic limit. The client then runs
 * POST /api/ingest/<content_id>/step until the job completes, as for an upload.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "upload");
  if (limited) return limited;
  const { contentId } = await context.params;
  if (!z.string().uuid().safeParse(contentId).success) return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose a topic limit between 3 and 40" }, { status: 400 });

  const ownerFilter = auth.user.role === "admin" ? "" : `&owner_id=eq.${auth.user.id}`;
  const [contents, profiles, { config }] = await Promise.all([
    supabaseRequest<Array<{ id: string; owner_id: string; status: string }>>(`contents?id=eq.${contentId}${ownerFilter}&select=id,owner_id,status`),
    supabaseRequest<Array<{ topic_cap: number | null }>>(`profiles?id=eq.${auth.user.id}&select=topic_cap`),
    getActiveConfig(),
  ]);
  const content = contents?.[0];
  if (!content) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  if (content.status !== "ready") return NextResponse.json({ error: "This source is still being processed" }, { status: 409 });

  const topicCap = resolveTopicCap(parsed.data.topic_cap ?? profiles?.[0]?.topic_cap, config);
  const job = await createRegroupJob({ contentId, ownerId: content.owner_id, topicCap });
  await logEvent({
    request_id: getOrCreateRequestId(request.headers.get("x-request-id")),
    user_hash: auth.user.userHash,
    type: "content.regroup",
    payload: { content_id: contentId, topic_cap: topicCap },
  });
  return NextResponse.json({ content_id: contentId, topic_cap: topicCap, job }, { status: 202 });
}
