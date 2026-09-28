import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ contentId: string }> };

/** Admin shares a source with every learner, or withdraws it. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser(request, "admin");
  if (auth.error) return auth.error;
  const { contentId } = await context.params;
  const body = z.object({ shared: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(contentId).success || !body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  await supabaseRequest(`contents?id=eq.${contentId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ shared: body.data.shared }) });
  await logEvent({ request_id: getOrCreateRequestId(request.headers.get("x-request-id")), user_hash: auth.user.userHash, type: "admin.content_shared", payload: { content_id: contentId, shared: body.data.shared } });
  return NextResponse.json({ ok: true });
}
