import type { AppConfig } from "@/lib/config/schema";
import { decayed, type MasteryRow } from "@/lib/learner-model/mastery";

const DAY_MS = 86_400_000;

export type DueTopic = {
  concept_id: string;
  /** Mastery today, after forgetting decay. */
  mastery_now: number;
  /** Mastery when last practised. */
  mastery_then: number;
  days_since: number;
  reason: "weak" | "fading";
};

/**
 * Topics worth reviewing now. A topic is only due after the learner has practised it at least once
 * (no nagging about unseen material) and at least a day ago (not mid-session).
 * weak: below the unlock threshold. fading: not mastered and untouched for review_after_days.
 * Weak topics come first, then the lowest mastery.
 */
export function dueForReview(rows: Array<MasteryRow & { concept_id: string }>, config: AppConfig, now = Date.now()): DueTopic[] {
  const due: DueTopic[] = [];
  for (const row of rows) {
    if (!row.last_seen || row.evidence_count <= 0) continue;
    const days = (now - new Date(row.last_seen).getTime()) / DAY_MS;
    if (days < 1) continue;
    const current = decayed(row, config, now);
    const reason = current < config.mastery.unlock_threshold ? "weak" : days >= config.engagement.review_after_days && current < config.mastery.mastered_threshold ? "fading" : null;
    if (!reason) continue;
    due.push({ concept_id: row.concept_id, mastery_now: Number(current.toFixed(4)), mastery_then: Number(row.mastery), days_since: Math.floor(days), reason });
  }
  return due.sort((a, b) => (a.reason === b.reason ? a.mastery_now - b.mastery_now : a.reason === "weak" ? -1 : 1));
}

/** True when the streak ends tomorrow unless the learner comes back: the last day of the grace window. */
export function streakAtRisk(gamification: { streak: number; last_active_on: string | null } | null, config: AppConfig, today = new Date().toISOString().slice(0, 10)) {
  if (!gamification?.last_active_on || gamification.streak < 2) return false;
  const gap = Math.round((new Date(today).getTime() - new Date(gamification.last_active_on).getTime()) / DAY_MS);
  return gap === 1 + config.mechanics.streak_grace_days;
}

export type NudgeKind = "review_due" | "streak_at_risk";

/**
 * Whether to send a nudge now. Respects the admin cadence (days between nudges) and weekly cap,
 * and needs a reason: topics due, or a streak about to end.
 */
export function nudgeDecision(input: { config: AppConfig; recent: Array<{ created_at: string }>; dueCount: number; atRisk: boolean; now?: number }): { send: false } | { send: true; kind: NudgeKind } {
  const { config, recent } = input;
  const now = input.now ?? Date.now();
  if (!config.engagement.nudges || config.engagement.max_per_week <= 0) return { send: false };
  const times = recent.map((row) => new Date(row.created_at).getTime());
  if (times.some((time) => now - time < config.engagement.cadence_days * DAY_MS)) return { send: false };
  if (times.filter((time) => now - time < 7 * DAY_MS).length >= config.engagement.max_per_week) return { send: false };
  if (input.dueCount > 0) return { send: true, kind: "review_due" };
  if (input.atRisk) return { send: true, kind: "streak_at_risk" };
  return { send: false };
}

/** Rough review length: about 80 seconds per topic, at least two minutes. */
export const reviewMinutes = (topics: number) => Math.max(2, Math.round((topics * 80) / 60));

/** The nudge text, in the journey's language. Names topics, never scores, so it reads as an invitation. */
export function nudgeMessage(input: { kind: NudgeKind; language: "en" | "roman_ur"; journeyTitle: string; topics: string[]; streak?: number }) {
  const ur = input.language === "roman_ur";
  const list = input.topics.slice(0, 3).join(", ");
  const minutes = reviewMinutes(input.topics.length);
  if (input.kind === "streak_at_risk") {
    return ur
      ? `Aapki ${input.streak ?? ""} din ki streak kal khatam ho jaye gi. Aaj sirf ${minutes} minute ka review usay bacha lega.`.replace("  ", " ")
      : `Your ${input.streak ?? ""}-day streak ends tomorrow. A ${minutes}-minute review today keeps it going.`.replace(" -day", " day");
  }
  return ur
    ? `"${input.journeyTitle}" ke ${input.topics.length} topics yaad se nikal rahe hain: ${list}. ${minutes} minute ka review unhein wapas le aaye ga.`
    : `${input.topics.length} ${input.topics.length === 1 ? "topic" : "topics"} from "${input.journeyTitle}" ${input.topics.length === 1 ? "is" : "are"} fading: ${list}. A ${minutes}-minute review brings ${input.topics.length === 1 ? "it" : "them"} back.`;
}
