import { NextResponse } from "next/server";
import { z } from "zod";

import { refreshSession } from "@/lib/auth/supabase-auth";
import { clientIp } from "@/lib/security/ip";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(clientIp(request), "default");
  if (limited) return limited;

  const parsed = z.object({ refresh_token: z.string().min(10).max(2_000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid refresh request" }, { status: 400 });

  const session = await refreshSession(parsed.data.refresh_token);
  if (!session) return NextResponse.json({ error: "Session expired, please sign in again" }, { status: 401 });
  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
