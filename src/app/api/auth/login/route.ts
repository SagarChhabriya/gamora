import { NextResponse } from "next/server";

import { credentialsSchema, signInWithPassword } from "@/lib/auth/supabase-auth";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { clientIp } from "@/lib/security/ip";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(clientIp(request), "auth");
  if (limited) return limited;

  const parsed = credentialsSchema.pick({ email: true, password: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });

  const session = await signInWithPassword(parsed.data.email, parsed.data.password);
  await logEvent({
    request_id: getOrCreateRequestId(request.headers.get("x-request-id")),
    type: "auth.login",
    ok: Boolean(session),
  });
  if (!session) return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
