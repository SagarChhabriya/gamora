import type { AppConfig } from "@/lib/config/schema";
import { decayed, emptyMastery, masteryLabel, type MasteryRow } from "@/lib/learner-model/mastery";
import { supabaseRequest } from "@/lib/supabase/server";

type MissionRow = { id: string; idx: number; title: string; story: string; concept_ids: string[]; activities: Array<{ type: string }>; unlock_rule: { min_mastery?: number; after_mission?: number | null } };
type SessionRow = { mission_id: string | null; completed_at: string | null; state: { index?: number; queue?: unknown[]; xp_earned?: number } };

export type MissionView = {
  id: string;
  idx: number;
  title: string;
  story: string;
  activity_count: number;
  activity_types: string[];
  status: "locked" | "available" | "in_progress" | "completed" | "practice";
  mastery: number;
  progress: number;
  lock_reason?: string;
  concepts: Array<{ id: string; name: string; mastery: number; label: string }>;
};

/**
 * Journey map state. A mission unlocks only when the previous mission is completed AND its
 * concepts reach the configured mastery threshold. Clicking through is not enough (M5).
 */
export async function loadJourneyView(journeyId: string, learnerId: string, config: AppConfig) {
  const [missions, sessions] = await Promise.all([
    supabaseRequest<MissionRow[]>(`missions?journey_id=eq.${journeyId}&select=id,idx,title,story,concept_ids,activities,unlock_rule&order=idx.asc`),
    supabaseRequest<SessionRow[]>(`sessions?journey_id=eq.${journeyId}&learner_id=eq.${learnerId}&select=mission_id,completed_at,state&order=started_at.desc`),
  ]);
  const conceptIds = [...new Set((missions ?? []).flatMap((mission) => mission.concept_ids))];
  const [concepts, masteryRows] = conceptIds.length
    ? await Promise.all([
        supabaseRequest<Array<{ id: string; name: string }>>(`concepts?id=in.(${conceptIds.join(",")})&select=id,name`),
        supabaseRequest<Array<MasteryRow & { concept_id: string }>>(`mastery?learner_id=eq.${learnerId}&concept_id=in.(${conceptIds.join(",")})&select=concept_id,mastery,confidence,evidence_count,last_seen`),
      ])
    : [[], []];
  const names = new Map((concepts ?? []).map((concept) => [concept.id, concept.name]));
  const mastery = new Map((masteryRows ?? []).map((row) => [row.concept_id, decayed({ ...row, mastery: Number(row.mastery), confidence: Number(row.confidence) }, config)]));

  const views: MissionView[] = [];
  for (const mission of missions ?? []) {
    const missionSessions = (sessions ?? []).filter((session) => session.mission_id === mission.id);
    const completed = missionSessions.some((session) => session.completed_at);
    const open = missionSessions.find((session) => !session.completed_at);
    const conceptViews = mission.concept_ids.map((id) => {
      const value = mastery.get(id) ?? emptyMastery.mastery;
      return { id, name: names.get(id) ?? "Concept", mastery: value, label: masteryLabel(value, config) };
    });
    const avg = conceptViews.length ? conceptViews.reduce((sum, concept) => sum + concept.mastery, 0) / conceptViews.length : 0;
    const threshold = mission.unlock_rule?.min_mastery ?? config.mastery.unlock_threshold;
    const previous = views[views.length - 1];
    let status: MissionView["status"] = "available";
    let lockReason: string | undefined;
    if (previous) {
      const prevRow = (missions ?? []).find((row) => row.id === previous.id);
      const prevThreshold = prevRow?.unlock_rule?.min_mastery ?? config.mastery.unlock_threshold;
      if (previous.status !== "completed") {
        status = "locked";
        lockReason = `Finish "${previous.title}" first.`;
      } else if (previous.mastery < prevThreshold) {
        status = "locked";
        lockReason = `Unlocks when "${previous.title}" reaches ${Math.round(prevThreshold * 100)}% mastery (now ${Math.round(previous.mastery * 100)}%). Try a practice round.`;
      }
    }
    if (status !== "locked") {
      if (completed && !open) status = avg >= threshold ? "completed" : "practice";
      else if (open) status = "in_progress";
    }
    const queueLength = open?.state?.queue?.length ?? mission.activities.length;
    views.push({
      id: mission.id,
      idx: mission.idx,
      title: mission.title,
      story: mission.story,
      activity_count: mission.activities.length,
      activity_types: [...new Set(mission.activities.map((activity) => activity.type))],
      status: status === "practice" ? "completed" : status,
      mastery: avg,
      progress: completed ? 1 : open ? Math.min(1, (open.state?.index ?? 0) / Math.max(1, queueLength)) : 0,
      lock_reason: lockReason,
      concepts: conceptViews,
    });
    // A completed mission below the threshold keeps the next one locked and offers practice.
    if (status === "practice") views[views.length - 1].status = "completed";
  }
  return views;
}
