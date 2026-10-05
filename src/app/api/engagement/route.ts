import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { reviewMinutes } from "@/lib/engagement/due";
import { loadEngagement } from "@/lib/engagement/load";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { reportError } from "@/lib/observability/sentry";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Nudge = { id: string; kind: string; message: string; payload: Record<string, unknown>; created_at: string; seen_at: string | null };

/** The learner's review card: topics due now, the mission that reviews them, and unread nudges (marked seen). */
export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  try {
    const { config } = await getActiveConfig();
    const [engagement, nudges] = await Promise.all([
      loadEngagement(auth.user.id, config),
      supabaseRequest<Nudge[]>(`nudges?learner_id=eq.${auth.user.id}&acted_at=is.null&select=id,kind,message,payload,created_at,seen_at&order=created_at.desc&limit=3`),
    ]);
    const unseen = (nudges ?? []).filter((nudge) => !nudge.seen_at);
    if (unseen.length) {
      await supabaseRequest(`nudges?id=in.(${unseen.map((nudge) => nudge.id).join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ seen_at: new Date().toISOString() }) });
      await logEvent({ request_id: requestId, user_hash: auth.user.userHash, type: "nudge.seen", payload: { count: unseen.length, kinds: unseen.map((nudge) => nudge.kind) } });
    }
    return NextResponse.json({
      enabled: config.engagement.nudges,
      ...engagement,
      review_minutes: engagement.review ? reviewMinutes(engagement.review.topics.length) : 0,
      nudge: nudges?.[0] ?? null,
    });
  } catch (error) {
    reportError(error, { requestId, userHash: auth.user.userHash, area: "engagement" });
    return NextResponse.json({ error: "Could not load your reviews" }, { status: 500 });
  }
}

const actSchema = z.object({ action: z.enum(["review_started", "dismissed"]), nudge_id: z.string().uuid().optional() });

/** Records what the learner did with the review card, for the re-engagement metrics. */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const parsed = actSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  if (parsed.data.nudge_id) {
    await supabaseRequest(`nudges?id=eq.${parsed.data.nudge_id}&learner_id=eq.${auth.user.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ acted_at: new Date().toISOString() }),
    }).catch(() => undefined);
  }
  await logEvent({ request_id: requestId, user_hash: auth.user.userHash, type: `nudge.${parsed.data.action}`, payload: { from_nudge: Boolean(parsed.data.nudge_id) } });
  return NextResponse.json({ ok: true });
}
