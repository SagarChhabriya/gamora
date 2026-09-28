import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { reportError } from "@/lib/observability/sentry";

export const runtime = "nodejs";

/** Admin drill: sends one labelled test error to Sentry and returns its event ID. */
export async function POST(request: Request) {
  const auth = await requireUser(request, "admin");
  if (auth.error) return auth.error;
  if (!process.env.SENTRY_DSN) return NextResponse.json({ error: "Sentry is not configured" }, { status: 503 });
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  reportError(new Error("Sentry check: test error from the admin drill"), { requestId, userHash: auth.user.userHash, area: "admin.sentry_check" });
  const eventId = Sentry.lastEventId();
  await Sentry.flush(3_000);
  return NextResponse.json({ ok: true, event_id: eventId, request_id: requestId });
}
