import type { AppConfig, EvidenceSignal } from "@/lib/config/schema";

export type GamificationRow = {
  xp: number;
  streak: number;
  best_streak: number;
  badges: string[];
  last_active_on: string | null;
  stats: Record<string, number>;
};

export const emptyGamification: GamificationRow = { xp: 0, streak: 0, best_streak: 0, badges: [], last_active_on: null, stats: {} };

export const badgeCatalog: Record<string, { name: string; description: string }> = {
  first_steps: { name: "First Steps", description: "Completed your first mission." },
  sharp_eye: { name: "Sharp Eye", description: "Spotted 3 procedure slips." },
  self_corrector: { name: "Second Look", description: "Fixed your own answer 3 times." },
  explainer: { name: "The Explainer", description: "Taught a concept back to a colleague." },
  cool_head: { name: "Cool Head", description: "Handled a role-play conversation well." },
  steady: { name: "Steady Hand", description: "Learned on 3 days in a row." },
  mastery_3: { name: "Solid Ground", description: "Mastered 3 concepts." },
  honest_check: { name: "Honest Check", description: "Your confidence matched your answers." },
};

/** XP for meaningful actions only, from the config table. No XP for clicks or hints. */
export function xpFor(signals: Array<{ signal: EvidenceSignal }>, config: AppConfig) {
  const xp = config.mechanics.xp;
  let total = 0;
  for (const { signal } of signals) {
    if (signal === "correct" || signal === "recall_success" || signal === "transfer") total += xp.correct;
    else if (signal === "partial") total += xp.partial;
    else if (signal === "self_corrected") total += xp.self_corrected;
    else if (signal === "teach_back") total += xp.teach_back;
    else if (signal === "calibrated") total += Math.round(xp.partial / 2);
  }
  return total;
}

function dayString(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Streaks never punish: a missed day inside the grace window keeps the streak. */
export function nextStreak(row: GamificationRow, config: AppConfig, now = new Date()) {
  const today = dayString(now);
  if (row.last_active_on === today) return { streak: Math.max(1, row.streak), last_active_on: today };
  if (!row.last_active_on) return { streak: 1, last_active_on: today };
  const gap = Math.round((new Date(today).getTime() - new Date(row.last_active_on).getTime()) / 86_400_000);
  const streak = gap <= 1 + config.mechanics.streak_grace_days ? row.streak + 1 : 1;
  return { streak, last_active_on: today };
}

export type RewardEvent = {
  signals: Array<{ signal: EvidenceSignal }>;
  activityType?: string;
  missionCompleted?: boolean;
  masteredCount?: number;
};

export function applyRewards(row: GamificationRow, event: RewardEvent, config: AppConfig, now = new Date()) {
  const gained = xpFor(event.signals, config) + (event.missionCompleted ? config.mechanics.xp.mission_complete : 0);
  const { streak, last_active_on } = nextStreak(row, config, now);
  const stats = { ...row.stats };
  const bump = (key: string) => (stats[key] = (stats[key] ?? 0) + 1);
  const has = (signal: EvidenceSignal) => event.signals.some((item) => item.signal === signal);
  if (event.missionCompleted) bump("missions");
  if (event.activityType === "spot_error" && has("correct")) bump("spot_errors");
  if (has("self_corrected")) bump("self_corrections");
  if (has("teach_back")) bump("teach_backs");
  if (event.activityType === "roleplay" && (has("correct") || has("transfer"))) bump("roleplays");
  if (has("calibrated")) bump("calibrated");
  if (event.masteredCount !== undefined) stats.mastered = Math.max(stats.mastered ?? 0, event.masteredCount);

  const earned = new Set(row.badges);
  const rules: Array<[string, boolean]> = [
    ["first_steps", (stats.missions ?? 0) >= 1],
    ["sharp_eye", (stats.spot_errors ?? 0) >= 3],
    ["self_corrector", (stats.self_corrections ?? 0) >= 3],
    ["explainer", (stats.teach_backs ?? 0) >= 1],
    ["cool_head", (stats.roleplays ?? 0) >= 1],
    ["steady", streak >= 3],
    ["mastery_3", (stats.mastered ?? 0) >= 3],
    ["honest_check", (stats.calibrated ?? 0) >= 1],
  ];
  const newBadges = rules.filter(([id, ok]) => ok && !earned.has(id)).map(([id]) => id);
  return {
    row: {
      xp: row.xp + gained,
      streak,
      best_streak: Math.max(row.best_streak, streak),
      badges: [...row.badges, ...newBadges],
      last_active_on,
      stats,
    },
    gained,
    newBadges,
  };
}

export const XP_PER_LEVEL = 200;

/** Player level from total XP. Flat steps keep the next level always in sight. */
export function playerLevel(xp: number) {
  const total = Math.max(0, Math.floor(xp));
  return { level: Math.floor(total / XP_PER_LEVEL) + 1, into: total % XP_PER_LEVEL, span: XP_PER_LEVEL };
}

/** Stars for a finished mission: 3 at the mastered threshold, 2 at the unlock threshold, else 1. */
export function starsFor(mastery: number, unlockThreshold: number, config: AppConfig) {
  if (mastery >= config.mastery.mastered_threshold) return 3;
  return mastery >= unlockThreshold ? 2 : 1;
}
