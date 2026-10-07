import type { AppConfig, EvidenceSignal } from "@/lib/config/schema";

export type MasteryRow = {
  mastery: number;
  confidence: number;
  evidence_count: number;
  last_seen: string | null;
};

const DAY_MS = 86_400_000;

/** Forgetting decay applied lazily on read (architecture section 6). */
export function decayed(row: MasteryRow, config: AppConfig, now = Date.now()) {
  if (!row.last_seen) return row.mastery;
  const days = Math.max(0, (now - new Date(row.last_seen).getTime()) / DAY_MS);
  return row.mastery * Math.exp(-config.mastery.decay_per_day * days);
}

/**
 * Weighted evidence update. Gains shrink as mastery rises, losses shrink as confidence rises, and
 * no single setback removes more than half of what was built, so one answer never decides a level.
 * Simple and explainable, not a psychometric claim (ADR-005).
 */
export function applyEvidence(
  row: MasteryRow,
  signals: Array<{ signal: EvidenceSignal; strength: number }>,
  config: AppConfig,
  now = Date.now(),
): MasteryRow {
  let mastery = decayed(row, config, now);
  let weighted = row.evidence_count;
  for (const { signal, strength } of signals) {
    const weight = config.mastery.evidence_weights[signal] ?? 0.5;
    const delta = weight * strength * config.mastery.step;
    const scaled = delta >= 0 ? delta * (1 - mastery * 0.5) : Math.max(delta * (1 - row.confidence * 0.5), -mastery * 0.5);
    mastery = Math.max(0, Math.min(1, mastery + scaled));
    weighted += weight;
  }
  const confidence = 1 - 1 / (1 + weighted * 0.35);
  return {
    mastery: Number(mastery.toFixed(4)),
    confidence: Number(Math.min(0.99, confidence).toFixed(4)),
    evidence_count: row.evidence_count + signals.length,
    last_seen: new Date(now).toISOString(),
  };
}

export const emptyMastery: MasteryRow = { mastery: 0, confidence: 0, evidence_count: 0, last_seen: null };

export function masteryLabel(value: number, config: AppConfig) {
  if (value >= config.mastery.mastered_threshold) return "mastered";
  if (value >= config.mastery.unlock_threshold) return "solid";
  if (value > 0.25) return "developing";
  return value > 0 ? "emerging" : "new";
}
