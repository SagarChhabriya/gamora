import { z } from "zod";

export const activityTypes = [
  "explain_ask",
  "scenario",
  "spot_error",
  "roleplay",
  "ordering",
  "teach_back",
  "spaced_recall",
  "reflection",
] as const;
export type ActivityType = (typeof activityTypes)[number];

export const evidenceSignals = [
  "correct",
  "partial",
  "wrong",
  "hint_used",
  "self_corrected",
  "transfer",
  "recall_success",
  "recall_fail",
  "teach_back",
  "calibrated",
  "overconfident",
] as const;
export type EvidenceSignal = (typeof evidenceSignals)[number];

export const personas = ["new_joiner", "busy_rm", "expert", "low_bandwidth"] as const;
export type Persona = (typeof personas)[number];

export const appConfigSchema = z.object({
  content: z.object({
    max_upload_mb: z.number().min(1).max(10).default(10),
    allowed_sources: z.array(z.enum(["pdf", "docx", "text", "url"])).default(["pdf", "docx", "text", "url"]),
  }),
  learner: z.object({
    default_level: z.number().int().min(1).max(5).default(2),
    default_persona: z.enum(personas).default("new_joiner"),
    session_minutes: z.number().int().min(3).max(120).default(15),
    minutes_per_mission: z.number().int().min(2).max(30).default(5),
  }),
  language: z.object({
    default: z.enum(["en", "roman_ur"]).default("en"),
    allowed: z.array(z.enum(["en", "roman_ur"])).min(1).default(["en", "roman_ur"]),
    code_switch_level: z.enum(["low", "medium", "high"]).default("medium"),
    allow_urdu_script: z.boolean().default(false),
  }),
  tone: z.object({
    persona_name: z.string().min(1).max(40).default("Noor"),
    formality: z.enum(["casual", "friendly", "formal"]).default("friendly"),
    humor: z.enum(["none", "light"]).default("light"),
    max_words: z.number().int().min(30).max(250).default(90),
  }),
  difficulty: z.object({
    min: z.number().int().min(1).max(5).default(1),
    max: z.number().int().min(1).max(5).default(5),
    step: z.number().int().min(1).max(2).default(1),
    sensitivity: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  mechanics: z.object({
    enabled_activities: z.array(z.enum(activityTypes)).min(3).default([...activityTypes]),
    xp: z.object({
      correct: z.number().int().min(0).max(100).default(20),
      partial: z.number().int().min(0).max(100).default(10),
      self_corrected: z.number().int().min(0).max(100).default(15),
      mission_complete: z.number().int().min(0).max(500).default(50),
      teach_back: z.number().int().min(0).max(100).default(25),
    }),
    streak_grace_days: z.number().int().min(0).max(7).default(1),
    leaderboard: z.boolean().default(false),
  }),
  mastery: z.object({
    unlock_threshold: z.number().min(0.3).max(0.95).default(0.6),
    mastered_threshold: z.number().min(0.5).max(1).default(0.8),
    decay_per_day: z.number().min(0).max(0.2).default(0.02),
    step: z.number().min(0.05).max(0.5).default(0.25),
    evidence_weights: z.record(z.enum(evidenceSignals), z.number().min(0).max(2)).default({
      correct: 1,
      partial: 0.5,
      wrong: 1,
      hint_used: 0.4,
      self_corrected: 0.6,
      transfer: 1.2,
      recall_success: 1.1,
      recall_fail: 0.8,
      teach_back: 1.2,
      calibrated: 0.3,
      overconfident: 0.3,
    }),
  }),
  grounding: z.object({
    must_cite: z.boolean().default(true),
    verifier: z.enum(["off", "lenient", "strict"]).default("strict"),
    abstain_message: z
      .string()
      .min(5)
      .max(300)
      .default("Your material does not cover that, so I will not guess. Let us stay with what the source says."),
  }),
  safety: z.object({
    tutor_rpm: z.number().int().min(5).max(120).default(30),
    daily_llm_calls: z.number().int().min(50).max(5_000).default(600),
    blocked_topics: z.array(z.string().max(60)).max(30).default([]),
    injection_strictness: z.enum(["standard", "strict"]).default("standard"),
  }),
  ui: z.object({
    text_only_default: z.boolean().default(false),
    high_contrast_default: z.boolean().default(false),
    celebrations: z.boolean().default(true),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/** Fills every missing field with its default. Accepts partial input. */
export function parseConfig(input: unknown): AppConfig {
  const value = (input ?? {}) as Record<string, unknown>;
  const sections = Object.keys(appConfigSchema.shape) as Array<keyof AppConfig>;
  const filled: Record<string, unknown> = {};
  for (const key of sections) {
    const section = value[key];
    filled[key] = section && typeof section === "object" ? section : {};
  }
  const mechanics = filled.mechanics as Record<string, unknown>;
  mechanics.xp = mechanics.xp && typeof mechanics.xp === "object" ? mechanics.xp : {};
  return appConfigSchema.parse(filled);
}

export const defaultConfig: AppConfig = parseConfig({});
