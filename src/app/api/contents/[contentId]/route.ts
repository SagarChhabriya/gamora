import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ contentId: string }> };

/** Removes a source the learner owns, with its chunks, concepts and journeys (cascade). */
export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { contentId } = await context.params;
  if (!z.string().uuid().safeParse(contentId).success) return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  const ownerFilter = auth.user.role === "admin" ? "" : `&owner_id=eq.${auth.user.id}`;
  const deleted = await supabaseRequest<Array<{ id: string }>>(`contents?id=eq.${contentId}${ownerFilter}&select=id`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!deleted?.length) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  await logEvent({ request_id: getOrCreateRequestId(request.headers.get("x-request-id")), user_hash: auth.user.userHash, type: "content.deleted", payload: { content_id: contentId } });
  return NextResponse.json({ ok: true });
}
