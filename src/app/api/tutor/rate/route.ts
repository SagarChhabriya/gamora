import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const rateSchema = z.object({
  mission_id: z.string().uuid(),
  kind: z.enum(["feedback", "answer", "character", "hint", "storyboard"]),
  useful: z.boolean(),
});

/** A learner says whether a tutor reply helped. Only the verdict and its kind are kept, never the text. */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "tutor");
  if (limited) return limited;
  const parsed = rateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  await logEvent({
    request_id: getOrCreateRequestId(request.headers.get("x-request-id")),
    user_hash: auth.user.userHash,
    type: "reply.rated",
    payload: parsed.data,
  });
  return NextResponse.json({ ok: true });
}
