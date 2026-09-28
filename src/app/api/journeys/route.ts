import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { personas, type Persona } from "@/lib/config/schema";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { planJourney } from "@/lib/planner/plan";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Profile = { persona: string | null; language_pref: string; time_budget_min: number; onboarding: { role?: string; goal?: string; prior?: string } };

/** Journeys for the signed-in learner with a progress summary. */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const journeys = await supabaseRequest<Array<{ id: string; title: string | null; content_id: string; language: string; persona: string | null; created_at: string; plan: { story_theme?: string } }>>(
    `journeys?learner_id=eq.${auth.user.id}&status=eq.ready&select=id,title,content_id,language,persona,created_at,plan&order=created_at.desc&limit=30`,
  );
  const ids = (journeys ?? []).map((journey) => journey.id);
  const [missions, sessions] = ids.length
    ? await Promise.all([
        supabaseRequest<Array<{ id: string; journey_id: string }>>(`missions?journey_id=in.(${ids.join(",")})&select=id,journey_id`),
        supabaseRequest<Array<{ journey_id: string; mission_id: string; completed_at: string | null }>>(
          `sessions?learner_id=eq.${auth.user.id}&journey_id=in.(${ids.join(",")})&completed_at=not.is.null&select=journey_id,mission_id,completed_at`,
        ),
      ])
    : [[], []];
  return NextResponse.json({
    journeys: (journeys ?? []).map((journey) => {
      const total = (missions ?? []).filter((mission) => mission.journey_id === journey.id).length;
      const done = new Set((sessions ?? []).filter((session) => session.journey_id === journey.id).map((session) => session.mission_id)).size;
      return { id: journey.id, title: journey.title, story_theme: journey.plan?.story_theme ?? "", language: journey.language, persona: journey.persona, created_at: journey.created_at, missions_total: total, missions_done: done };
    }),
  });
}

const createSchema = z.object({ content_id: z.string().uuid() });

/** Plans a new journey from a ready content map, personalised to the learner profile. */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "upload");
  if (limited) return limited;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const contentId = parsed.data.content_id;
  const started = Date.now();

  try {
    const contents = await supabaseRequest<Array<{ id: string; title: string; status: string; owner_id: string; shared: boolean }>>(
      `contents?id=eq.${contentId}&select=id,title,status,owner_id,shared`,
    );
    const content = contents?.[0];
    if (!content || (content.owner_id !== auth.user.id && !content.shared && auth.user.role !== "admin")) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    if (content.status !== "ready") return NextResponse.json({ error: "This source is still being processed" }, { status: 409 });

    const [concepts, profiles, active] = await Promise.all([
      supabaseRequest<Array<{ id: string; name: string; summary: string; difficulty: number }>>(`concepts?content_id=eq.${contentId}&select=id,name,summary,difficulty&order=created_at.asc`),
      supabaseRequest<Profile[]>(`profiles?id=eq.${auth.user.id}&select=persona,language_pref,time_budget_min,onboarding`),
      getActiveConfig(),
    ]);
    if (!concepts?.length) return NextResponse.json({ error: "No concepts were found in this source" }, { status: 422 });
    const conceptIds = concepts.map((concept) => concept.id);
    const edges = (await supabaseRequest<Array<{ from_id: string; to_id: string; type: string }>>(`concept_edges?from_id=in.(${conceptIds.join(",")})&select=from_id,to_id,type`)) ?? [];
    const profile = profiles?.[0];
    const persona: Persona = (personas as readonly string[]).includes(profile?.persona ?? "") ? (profile?.persona as Persona) : active.config.learner.default_persona;
    const language = profile?.language_pref === "roman_ur" && active.config.language.allowed.includes("roman_ur") ? "roman_ur" : active.config.language.default;

    const plan = await planJourney({
      title: content.title,
      concepts,
      edges,
      profile: {
        persona,
        role: profile?.onboarding?.role,
        goal: profile?.onboarding?.goal,
        prior: profile?.onboarding?.prior,
        time_budget_min: profile?.time_budget_min ?? active.config.learner.session_minutes,
        language,
      },
      config: active.config,
      configVersion: active.version,
      requestId,
      userHash: auth.user.userHash,
    });

    const journeys = await supabaseRequest<Array<{ id: string }>>("journeys?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        content_id: contentId,
        learner_id: auth.user.id,
        config_version: active.version,
        title: plan.title,
        language,
        persona,
        status: "ready",
        plan: { title: plan.title, story_theme: plan.story_theme, planner: plan.planner },
      }),
    });
    const journeyId = journeys?.[0]?.id;
    if (!journeyId) throw new Error("Could not save the journey");
    await supabaseRequest("missions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(
        plan.missions.map((mission) => ({
          journey_id: journeyId,
          idx: mission.idx,
          title: mission.title,
          story: mission.story_hook,
          concept_ids: mission.concept_ids,
          activities: mission.activities,
          unlock_rule: mission.unlock_rule,
        })),
      ),
    });
    await logEvent({
      request_id: requestId,
      user_hash: auth.user.userHash,
      type: "journey.created",
      latency_ms: Date.now() - started,
      payload: { journey_id: journeyId, content_id: contentId, missions: plan.missions.length, planner: plan.planner, persona, language },
    });
    return NextResponse.json({ journey_id: journeyId, planner: plan.planner }, { status: 201 });
  } catch (error) {
    await logEvent({ request_id: requestId, user_hash: auth.user.userHash, type: "journey.created", ok: false, payload: { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
    return NextResponse.json({ error: "Could not plan the journey. Please try again." }, { status: 500 });
  }
}
