import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { rankLeaderboard, type LeaderboardRow } from "@/lib/gamification/leaderboard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * XP leaderboard, shown only when the admin turns it on. Real learners only: admins and synthetic
 * demo learners are left out. Names are first names only.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { config } = await getActiveConfig();
  if (!config.mechanics.leaderboard) return NextResponse.json({ enabled: false }, { status: 404 });
  const limited = await enforceRateLimit(auth.user.id, "tutor");
  if (limited) return limited;

  const learners = (await supabaseRequest<Array<{ id: string; display_name: string | null }>>("profiles?role=eq.learner&is_demo=eq.false&select=id,display_name")) ?? [];
  if (!learners.length) return NextResponse.json({ enabled: true, top: [], you: null });
  const names = new Map(learners.map((row) => [row.id, row.display_name]));
  const scores = (await supabaseRequest<Array<{ learner_id: string; xp: number; streak: number }>>("gamification?xp=gt.0&select=learner_id,xp,streak&order=xp.desc&limit=500")) ?? [];
  const rows: LeaderboardRow[] = scores.filter((row) => names.has(row.learner_id)).map((row) => ({ ...row, display_name: names.get(row.learner_id) ?? null }));
  return NextResponse.json({ enabled: true, ...rankLeaderboard(rows, auth.user.id) });
}
