import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { badgeCatalog } from "@/lib/gamification/rewards";
import { loadJourneyView } from "@/lib/journey/load";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ journeyId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { journeyId } = await context.params;
  if (!z.string().uuid().safeParse(journeyId).success) return NextResponse.json({ error: "Invalid journey" }, { status: 400 });

  const journeys = await supabaseRequest<Array<{ id: string; learner_id: string; title: string | null; content_id: string; language: string; persona: string | null; plan: { story_theme?: string; planner?: string } }>>(
    `journeys?id=eq.${journeyId}&select=id,learner_id,title,content_id,language,persona,plan`,
  );
  const journey = journeys?.[0];
  if (!journey || (journey.learner_id !== auth.user.id && auth.user.role !== "admin")) {
    return NextResponse.json({ error: "Journey not found" }, { status: 404 });
  }
  const { config } = await getActiveConfig();
  const [missions, gamification, profiles] = await Promise.all([
    loadJourneyView(journeyId, journey.learner_id, config),
    supabaseRequest<Array<{ xp: number; streak: number; best_streak: number; badges: string[] }>>(`gamification?learner_id=eq.${journey.learner_id}&select=xp,streak,best_streak,badges`),
    supabaseRequest<Array<{ persona: string | null; language_pref: string }>>(`profiles?id=eq.${journey.learner_id}&select=persona,language_pref`),
  ]);
  const game = gamification?.[0] ?? { xp: 0, streak: 0, best_streak: 0, badges: [] };
  return NextResponse.json({
    journey: { id: journey.id, title: journey.title, story_theme: journey.plan?.story_theme ?? "", planner: journey.plan?.planner, language: journey.language, persona: journey.persona },
    missions,
    learner: {
      persona: profiles?.[0]?.persona ?? config.learner.default_persona,
      language: profiles?.[0]?.language_pref ?? config.language.default,
      xp: game.xp,
      streak: game.streak,
      best_streak: game.best_streak,
      badges: (game.badges ?? []).map((id) => ({ id, ...(badgeCatalog[id] ?? { name: id, description: "" }) })),
    },
    thresholds: { unlock: config.mastery.unlock_threshold, mastered: config.mastery.mastered_threshold },
    ui: { celebrations: config.ui.celebrations, text_only_default: config.ui.text_only_default, high_contrast_default: config.ui.high_contrast_default },
    languages: config.language.allowed,
  });
}
