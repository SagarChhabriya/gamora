import { NextResponse } from "next/server";

import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { healthResponseSchema } from "@/lib/security/validation";

function isConfigured(...values: Array<string | undefined>) {
  return values.every((value) => Boolean(value));
}

export function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const checks = {
    app: "ok" as const,
    supabase: isConfigured(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
      ? ("configured" as const)
      : ("missing" as const),
    llm: isConfigured(
      process.env.LLM_PRIMARY_PROVIDER,
      process.env.LLM_REASONING_MODEL,
      process.env.LLM_FAST_MODEL,
    )
      ? ("configured" as const)
      : ("missing" as const),
    redis: isConfigured(
      process.env.UPSTASH_REDIS_REST_URL,
      process.env.UPSTASH_REDIS_REST_TOKEN,
    )
      ? ("configured" as const)
      : ("missing" as const),
  };
  const status = Object.values(checks).every((value) => value !== "missing")
    ? "ok"
    : "degraded";
  const payload = healthResponseSchema.parse({
    status,
    request_id: requestId,
    checks,
  });

  return NextResponse.json(payload, {
    status: status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
