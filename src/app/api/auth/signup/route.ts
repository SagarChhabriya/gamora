import { NextResponse } from "next/server";

import { createLearnerAccount, credentialsSchema, signInWithPassword } from "@/lib/auth/supabase-auth";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { clientIp } from "@/lib/security/ip";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(clientIp(request), "auth");
  if (limited) return limited;

  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Use a valid email and a password of at least 8 characters" }, { status: 400 });
  }

  const created = await createLearnerAccount(parsed.data.email, parsed.data.password, parsed.data.display_name);
  await logEvent({
    request_id: getOrCreateRequestId(request.headers.get("x-request-id")),
    type: "auth.signup",
    ok: !created.error,
  });
  if (created.error) return NextResponse.json({ error: created.error }, { status: 400 });

  const session = await signInWithPassword(parsed.data.email, parsed.data.password);
  if (!session) return NextResponse.json({ error: "Account created. Please sign in." }, { status: 201 });
  return NextResponse.json(session, { status: 201, headers: { "Cache-Control": "no-store" } });
}
