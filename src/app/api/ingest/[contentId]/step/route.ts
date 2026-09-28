import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getJobForContent, runIngestStep } from "@/lib/ingest/pipeline";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ contentId: string }> };

/** Runs the next ingest step for this content. Safe to call repeatedly. */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "ingest_step");
  if (limited) return limited;

  const { contentId } = await context.params;
  if (!z.string().uuid().safeParse(contentId).success) {
    return NextResponse.json({ error: "Invalid content ID" }, { status: 400 });
  }

  const job = await getJobForContent(contentId, auth.user.role === "admin" ? undefined : auth.user.id);
  if (!job) return NextResponse.json({ error: "Ingest job not found" }, { status: 404 });

  const result = await runIngestStep(job, {
    requestId: getOrCreateRequestId(request.headers.get("x-request-id")),
    userHash: auth.user.userHash,
  });
  return NextResponse.json({ job: result }, { status: result.status === "failed" ? 422 : 200 });
}
