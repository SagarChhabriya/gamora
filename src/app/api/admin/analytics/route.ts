import { NextResponse } from "next/server";
import { applyFilters, computeDashboard } from "@/lib/analytics/compute";
import { readFilters } from "@/lib/analytics/filters";
import { loadRaw } from "@/lib/analytics/load";
import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await requireUser(request, "admin");
  if (auth.error) return auth.error;
  const parsed = readFilters(request.url);
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  const { reveal, ...filters } = parsed.data;
  const [{ config }, raw] = await Promise.all([getActiveConfig(), loadRaw()]);
  const filtered = applyFilters(raw, filters);
  if (reveal === "1") {
    await logEvent({ request_id: getOrCreateRequestId(request.headers.get("x-request-id")), user_hash: auth.user.userHash, type: "admin.reveal_identities", payload: { filters } });
  }
  return NextResponse.json({
    dashboard: computeDashboard(filtered, config, { reveal: reveal === "1" }),
    options: {
      contents: raw.contents,
      personas: [...new Set(raw.profiles.map((profile) => profile.persona).filter(Boolean))],
      has_demo: raw.profiles.some((profile) => profile.is_demo),
    },
    generated_at: new Date().toISOString(),
  });
}
