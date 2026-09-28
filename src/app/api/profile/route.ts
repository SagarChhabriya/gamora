import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { personas } from "@/lib/config/schema";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const rows = await supabaseRequest<Array<{ display_name: string | null; role: string; persona: string | null; language_pref: string; time_budget_min: number; onboarding: Record<string, unknown> }>>(
    `profiles?id=eq.${auth.user.id}&select=display_name,role,persona,language_pref,time_budget_min,onboarding`,
  );
  const profile = rows?.[0];
  return NextResponse.json({ profile, onboarded: Boolean(profile?.onboarding && Object.keys(profile.onboarding).length) });
}

const updateSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional(),
  persona: z.enum(personas).optional(),
  language_pref: z.enum(["en", "roman_ur"]).optional(),
  time_budget_min: z.number().int().min(3).max(240).optional(),
  onboarding: z
    .object({
      role: z.string().trim().max(120).optional(),
      goal: z.string().trim().max(200).optional(),
      prior: z.enum(["new", "some", "confident"]).optional(),
      time: z.string().trim().max(40).optional(),
      language: z.enum(["en", "roman_ur"]).optional(),
      completed_at: z.string().max(40).optional(),
    })
    .optional(),
});

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile update" }, { status: 400 });
  await supabaseRequest(`profiles?id=eq.${auth.user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(parsed.data),
  });
  if (parsed.data.onboarding) {
    await logEvent({
      request_id: getOrCreateRequestId(request.headers.get("x-request-id")),
      user_hash: auth.user.userHash,
      type: "learner.onboarded",
      payload: { persona: parsed.data.persona, language: parsed.data.language_pref, minutes: parsed.data.time_budget_min },
    });
  }
  return NextResponse.json({ ok: true });
}

/** Delete my data: removes the auth user, which cascades to every learner table. */
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  const response = await fetch(`${url}/auth/v1/admin/users/${auth.user.id}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  await logEvent({ request_id: getOrCreateRequestId(request.headers.get("x-request-id")), type: "learner.deleted", ok: response.ok });
  if (!response.ok) return NextResponse.json({ error: "Could not delete your data" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
