import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { hashUserId } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { maybeNudge } from "@/lib/engagement/load";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { reportError } from "@/lib/observability/sentry";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Daily re-engagement job (Vercel Cron, see vercel.json). For every real learner it decides from
 * the admin cadence whether a review nudge is due and stores it for the home page. Demo learners
 * are skipped. Channels beyond in-app (email, Teams) would read the same nudges table.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const started = Date.now();
  const { config } = await getActiveConfig();
  if (!config.engagement.nudges) return NextResponse.json({ sent: 0, reason: "nudges are off" });

  const learners = (await supabaseRequest<Array<{ id: string }>>("profiles?role=eq.learner&is_demo=eq.false&select=id")) ?? [];
  let sent = 0;
  let failed = 0;
  for (let start = 0; start < learners.length; start += 5) {
    const results = await Promise.allSettled(learners.slice(start, start + 5).map((learner) => maybeNudge(learner.id, config).then((nudge) => ({ learner, nudge }))));
    for (const result of results) {
      if (result.status === "rejected") {
        failed += 1;
        reportError(result.reason, { requestId, area: "cron.nudges" });
        continue;
      }
      if (!result.value.nudge) continue;
      sent += 1;
      await logEvent({ request_id: requestId, user_hash: hashUserId(result.value.learner.id), type: "nudge.sent", payload: { kind: result.value.nudge.kind, topics: result.value.nudge.topics } });
    }
    if (Date.now() - started > 50_000) break;
  }
  await logEvent({ request_id: requestId, type: "cron.nudges", ok: failed === 0, latency_ms: Date.now() - started, payload: { learners: learners.length, sent, failed } });
  return NextResponse.json({ learners: learners.length, sent, failed });
}
