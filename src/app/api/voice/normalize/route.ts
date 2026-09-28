import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { normaliseToRomanUrdu } from "@/lib/voice/normalise";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "tutor");
  if (limited) return limited;
  const parsed = z.object({ text: z.string().min(1).max(1_500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const text = await normaliseToRomanUrdu(parsed.data.text, {
    requestId: getOrCreateRequestId(request.headers.get("x-request-id")),
    userHash: auth.user.userHash,
  });
  return NextResponse.json({ text });
}
