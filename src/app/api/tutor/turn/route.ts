import { after, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { runTurn, schedulePrefetch, TurnError, turnSchema } from "@/lib/tutor/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One tutor turn. Streams newline-delimited JSON events so feedback shows before the next
 * activity finishes generating.
 */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = (await enforceRateLimit(auth.user.id, "tutor")) ?? (await enforceRateLimit(auth.user.id, "llm_daily"));
  if (limited) return limited;

  const parsed = turnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid turn request" }, { status: 400 });
  const body = parsed.data;
  const user = auth.user;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runTurn(user, body, requestId)) send(event);
      } catch (error) {
        const known = error instanceof TurnError;
        send({ type: "error", message: known ? error.message : "Something went wrong on our side. Please try again." });
        await logEvent({
          request_id: requestId,
          user_hash: user.userHash,
          type: "error",
          ok: false,
          payload: { route: "tutor.turn", action: body.action, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
        });
      } finally {
        controller.close();
      }
    },
  });

  if (body.action === "start" || body.action === "answer" || body.action === "set_language" || body.action === "set_persona") {
    after(() => schedulePrefetch(user, body.mission_id, requestId));
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
