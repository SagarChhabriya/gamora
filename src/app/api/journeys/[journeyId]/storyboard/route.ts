import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { noticeMessages, withLlmNotices } from "@/lib/llm/notices";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { reportError } from "@/lib/observability/sentry";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { ensureStoryboard, loadJourneyForStoryboard } from "@/lib/storyboard/generate";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ journeyId: string }> };

/** The journey's storyboard. Built on first request if the background build has not finished. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { journeyId } = await context.params;
  if (!z.string().uuid().safeParse(journeyId).success) return NextResponse.json({ error: "Invalid journey" }, { status: 400 });

  const journey = await loadJourneyForStoryboard(journeyId);
  if (!journey || (journey.learner_id !== auth.user.id && auth.user.role !== "admin")) {
    return NextResponse.json({ error: "Journey not found" }, { status: 404 });
  }
  const { config } = await getActiveConfig();
  if (!config.mechanics.storyboard) return NextResponse.json({ error: "Storyboards are turned off" }, { status: 404 });
  if (!journey.plan?.storyboard) {
    // Building one calls the model, so it counts against the learner's tutor limits.
    const limited = (await enforceRateLimit(auth.user.id, "tutor")) ?? (await enforceRateLimit(auth.user.id, "llm_daily"));
    if (limited) return limited;
  }
  try {
    const { result: storyboard, notices } = await withLlmNotices(() => ensureStoryboard({ journey, config, requestId, userHash: auth.user.userHash }));
    if (storyboard === "pending") return NextResponse.json({ status: "pending" }, { status: 202 });
    return NextResponse.json({ storyboard, notices: noticeMessages(notices) });
  } catch (error) {
    reportError(error, { requestId, userHash: auth.user.userHash, area: "storyboard" });
    return NextResponse.json({ error: "Could not prepare the storyboard. Please try again." }, { status: 500 });
  }
}
