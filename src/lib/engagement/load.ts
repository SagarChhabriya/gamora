import type { AppConfig } from "@/lib/config/schema";
import { dueForReview, nudgeDecision, nudgeMessage, streakAtRisk, type DueTopic, type NudgeKind } from "@/lib/engagement/due";
import type { MasteryRow } from "@/lib/learner-model/mastery";
import { supabaseRequest } from "@/lib/supabase/server";

type JourneyRow = { id: string; title: string | null; language: string };
type MissionRow = { id: string; journey_id: string; idx: number; title: string; concept_ids: string[] };

export type Review = {
  journey_id: string;
  journey_title: string;
  mission_id: string;
  mission_title: string;
  language: "en" | "roman_ur";
  topics: Array<DueTopic & { name: string }>;
};

export type Engagement = {
  due_count: number;
  review: Review | null;
  streak: number;
  streak_at_risk: boolean;
  days_away: number | null;
};

/**
 * What a learner should come back to: the journey with the most topics due, and the mission there
 * that holds most of them, so one review covers as many as possible.
 */
export async function loadEngagement(learnerId: string, config: AppConfig, now = Date.now()): Promise<Engagement> {
  const [masteryRows, journeys, gamification] = await Promise.all([
    supabaseRequest<Array<MasteryRow & { concept_id: string }>>(`mastery?learner_id=eq.${learnerId}&select=concept_id,mastery,confidence,evidence_count,last_seen`),
    supabaseRequest<JourneyRow[]>(`journeys?learner_id=eq.${learnerId}&select=id,title,language`),
    supabaseRequest<Array<{ streak: number; last_active_on: string | null }>>(`gamification?learner_id=eq.${learnerId}&select=streak,last_active_on`),
  ]);
  const game = gamification?.[0] ?? null;
  const today = new Date(now).toISOString().slice(0, 10);
  const daysAway = game?.last_active_on ? Math.round((new Date(today).getTime() - new Date(game.last_active_on).getTime()) / 86_400_000) : null;
  const base = { streak: game?.streak ?? 0, streak_at_risk: streakAtRisk(game, config, today), days_away: daysAway };

  const due = dueForReview((masteryRows ?? []).map((row) => ({ ...row, mastery: Number(row.mastery), confidence: Number(row.confidence) })), config, now);
  if (!due.length || !journeys?.length) return { ...base, due_count: due.length, review: null };

  const missions = (await supabaseRequest<MissionRow[]>(`missions?journey_id=in.(${journeys.map((row) => row.id).join(",")})&select=id,journey_id,idx,title,concept_ids&order=idx.asc`)) ?? [];
  const dueIds = new Set(due.map((row) => row.concept_id));
  // Most due topics first; earlier missions win ties so review follows the learning order.
  const best = missions
    .map((mission) => ({ mission, hits: mission.concept_ids.filter((id) => dueIds.has(id)).length }))
    .filter((row) => row.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.mission.idx - b.mission.idx)[0];
  if (!best) return { ...base, due_count: due.length, review: null };

  const inMission = new Set(best.mission.concept_ids);
  const chosen = due.filter((row) => inMission.has(row.concept_id)).slice(0, config.engagement.review_size);
  const names = (await supabaseRequest<Array<{ id: string; name: string }>>(`concepts?id=in.(${chosen.map((row) => row.concept_id).join(",")})&select=id,name`)) ?? [];
  const nameOf = new Map(names.map((row) => [row.id, row.name]));
  const journey = journeys.find((row) => row.id === best.mission.journey_id)!;
  return {
    ...base,
    due_count: due.length,
    review: {
      journey_id: journey.id,
      journey_title: journey.title ?? "Your journey",
      mission_id: best.mission.id,
      mission_title: best.mission.title,
      language: journey.language === "roman_ur" ? "roman_ur" : "en",
      topics: chosen.map((row) => ({ ...row, name: nameOf.get(row.concept_id) ?? "Topic" })),
    },
  };
}

/**
 * Creates a nudge when the cadence and weekly cap allow it and there is a reason. Returns the new
 * nudge, or null. Used by the daily job; the home page reads nudges, it never creates them.
 */
export async function maybeNudge(learnerId: string, config: AppConfig, now = Date.now()) {
  const engagement = await loadEngagement(learnerId, config, now);
  const since = new Date(now - 7 * 86_400_000).toISOString();
  const recent = (await supabaseRequest<Array<{ created_at: string }>>(`nudges?learner_id=eq.${learnerId}&created_at=gte.${since}&select=created_at`)) ?? [];
  const decision = nudgeDecision({ config, recent, dueCount: engagement.review?.topics.length ?? 0, atRisk: engagement.streak_at_risk, now });
  if (!decision.send) return null;
  const kind: NudgeKind = decision.kind;
  const review = engagement.review;
  const message = nudgeMessage({
    kind,
    language: review?.language ?? (config.language.default === "roman_ur" ? "roman_ur" : "en"),
    journeyTitle: review?.journey_title ?? "",
    topics: review?.topics.map((topic) => topic.name) ?? [],
    streak: engagement.streak,
  });
  const payload = review ? { journey_id: review.journey_id, mission_id: review.mission_id, concept_ids: review.topics.map((topic) => topic.concept_id) } : {};
  const rows = await supabaseRequest<Array<{ id: string }>>("nudges", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ learner_id: learnerId, kind, message, payload }),
  });
  return rows?.[0] ? { id: rows[0].id, kind, topics: review?.topics.length ?? 0 } : null;
}
