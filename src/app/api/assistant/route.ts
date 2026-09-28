import { NextResponse } from "next/server";
import { z } from "zod";

import { askAssistant } from "@/lib/assistant/answer";
import { formatSnapshot, loadLearnerSnapshot, snapshotLinks } from "@/lib/assistant/context";
import { appGuide } from "@/lib/assistant/guide";
import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { reportError } from "@/lib/observability/sentry";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(600),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(1_200) }))
    .max(12)
    .default([]),
});

/**
 * Help assistant: how to use Gamora and the learner's own progress. Material questions go to the
 * grounded Ask box inside a mission. Message text is never logged.
 */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = (await enforceRateLimit(auth.user.id, "assistant")) ?? (await enforceRateLimit(auth.user.id, "llm_daily"));
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid message" }, { status: 400 });

  const started = Date.now();
  try {
    const { config } = await getActiveConfig();
    const snapshot = await loadLearnerSnapshot(auth.user.id, "there", config);
    const links = snapshotLinks(snapshot);
    const result = await askAssistant({
      message: parsed.data.message,
      history: parsed.data.history,
      guide: appGuide(config),
      snapshot: formatSnapshot(snapshot),
      links,
      language: snapshot.language,
      requestId,
      userHash: auth.user.userHash,
    });
    await logEvent({ request_id: requestId, user_hash: auth.user.userHash, type: "assistant.reply", ok: result.ok, latency_ms: Date.now() - started, payload: { links: result.links.length } });
    return NextResponse.json({ reply: result.reply, links: result.links });
  } catch (error) {
    reportError(error, { requestId, userHash: auth.user.userHash, area: "assistant" });
    return NextResponse.json({ error: "The assistant is unavailable right now. Please try again." }, { status: 500 });
  }
}
