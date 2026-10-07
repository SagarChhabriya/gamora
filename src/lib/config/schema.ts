import { z } from "zod";

import { normaliseDomain } from "@/lib/ingest/security";

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

/**
 * Steps the planner places itself, switched on and off as mechanics rather than listed with the
 * activity types, so saved configs that list activity types keep working unchanged.
 * capstone: one case that needs two or more topics at once. crossroads: a decision whose outcome
 * carries into the next step.
 */
export const specialSteps = ["capstone", "crossroads"] as const;
export type SpecialStep = (typeof specialSteps)[number];
export type PlanStepType = ActivityType | SpecialStep;

/** How a journey goes through its topics. The learner picks one when building a journey. */
export const learningRoutes = ["narrative", "scenarios", "quick_scan", "focus"] as const;
export type LearningRoute = (typeof learningRoutes)[number];
export const routeInfo: Record<LearningRoute, { label: string; description: string }> = {
  narrative: { label: "Narrative", description: "Ideas arrive inside one continuing story, starting with the storyboard." },
  scenarios: { label: "Scenarios", description: "Situations to act in, where your decisions carry consequences." },
  quick_scan: { label: "Quick scan", description: "A fast pass over every topic, one light check each." },
  focus: { label: "Focus", description: "One topic at a time, with worked examples and a teach-back." },
};

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

/** What learners see. The ids above are stored in profiles and configs, so they stay stable. */
export const personaLabels: Record<Persona, string> = {
  new_joiner: "Beginner",
  busy_rm: "Short on time",
  expert: "Experienced",
  low_bandwidth: "Slow connection",
};

/** Sites that serve readable text to a plain HTTP fetch. Paywalled and script-rendered sites are left out. */
export const defaultUrlDomains = [
  "wikipedia.org",
  "wikibooks.org",
  "developer.mozilla.org",
  "learn.microsoft.com",
  "docs.python.org",
  "raw.githubusercontent.com",
  "sbp.org.pk",
  "secp.gov.pk",
] as const;

/** Gemini TTS voices offered in admin settings. All of them speak Urdu and English. */
export const cloudVoices = ["Kore", "Aoede", "Leda", "Zephyr", "Puck", "Charon", "Orus", "Fenrir"] as const;

/**
 * Deepgram Aura-2 English voices. Aura-2 has no Urdu or Hindi voice (checked 2026-10-07), so a
 * Roman Urdu line is always spoken by the Gemini voice or the device, never by these.
 */
export const deepgramVoices = [
  "aura-2-thalia-en",
  "aura-2-andromeda-en",
  "aura-2-helena-en",
  "aura-2-asteria-en",
  "aura-2-luna-en",
  "aura-2-apollo-en",
  "aura-2-arcas-en",
  "aura-2-orion-en",
  "aura-2-draco-en",
] as const;

export const appConfigSchema = z.object({
  content: z.object({
    max_upload_mb: z.number().min(1).max(10).default(10),
    allowed_sources: z.array(z.enum(["pdf", "docx", "text", "url"])).default(["pdf", "docx", "text", "url"]),
    // Sites a URL source may come from. A domain also allows its subdomains. Empty allows any public site.
    url_domains: z
      .array(z.string().transform(normaliseDomain).pipe(z.string().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, "Enter a domain like example.com")))
      .max(50)
      .default([...defaultUrlDomains]),
    // A long source is grouped into at most this many topics. Learners can pick their own limit up to topics_max.
    topics_default: z.number().int().min(3).max(40).default(12),
    topics_max: z.number().int().min(3).max(40).default(30),
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
    persona_name: z.string().min(1).max(40).default("Sagar"),
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
    // Illustrated preview of a journey, played before the first mission. Each topic gets one scene
    // per idea it holds, up to storyboard_scenes_per_topic, and the whole storyboard at most
    // storyboard_panels scenes.
    storyboard: z.boolean().default(true),
    storyboard_panels: z.number().int().min(3).max(24).default(12),
    storyboard_scenes_per_topic: z.number().int().min(1).max(7).default(3),
    // A closing mission whose case needs two or more topics at once.
    capstone: z.boolean().default(true),
    // One decision per mission whose outcome carries into the next step.
    crossroads: z.boolean().default(true),
  }),
  mastery: z.object({
    unlock_threshold: z.number().min(0.3).max(0.95).default(0.5),
    mastered_threshold: z.number().min(0.5).max(1).default(0.8),
    decay_per_day: z.number().min(0).max(0.2).default(0.02),
    step: z.number().min(0.05).max(0.5).default(0.35),
    evidence_weights: z.record(z.enum(evidenceSignals), z.number().min(0).max(2)).default({
      correct: 1,
      partial: 0.8,
      wrong: 0.6,
      hint_used: 0.2,
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
  voice: z.object({
    // cloud: a generated Pakistani voice that speaks Urdu and English (Gemini); deepgram: Deepgram
    // Aura-2 for English lines, with Roman Urdu lines still spoken by Gemini; browser: the device's
    // own voices. Every cloud choice falls back to the device voice when the service is busy or off.
    engine: z.enum(["cloud", "deepgram", "browser"]).default("cloud"),
    cloud_voice: z.enum(cloudVoices).default("Kore"),
    deepgram_voice: z.enum(deepgramVoices).default("aura-2-thalia-en"),
    // Server transcription, used when the browser has no speech recognition of its own (or always,
    // with stt_server_first). groq: Whisper; deepgram: Nova-3, which supports Urdu.
    stt_provider: z.enum(["groq", "deepgram"]).default("groq"),
    // Push to talk records and sends audio to the server transcriber even when the browser could
    // listen itself. Hands-free keeps the browser's recogniser, which knows when the learner stops.
    stt_server_first: z.boolean().default(false),
    // When the chosen cloud provider fails, try the other one before the device voice or typing.
    cloud_backup: z.boolean().default(false),
  }),
  media: z.object({
    // Illustrations for storyboard panels, made once per topic of a source and shared by every learner.
    // Off until billing is on for the Gemini key: image models have no free tier.
    images: z.boolean().default(false),
    image_tier: z.enum(["economy", "standard"]).default("economy"),
    monthly_budget_usd: z.number().min(0).max(500).default(5),
    max_images_per_source: z.number().int().min(0).max(40).default(12),
  }),
  engagement: z.object({
    nudges: z.boolean().default(true),
    // A topic is due for review this many days after it was last practised, if it is not mastered.
    review_after_days: z.number().int().min(1).max(30).default(3),
    // At most one nudge per learner every this many days, and no more than max_per_week in 7 days.
    cadence_days: z.number().int().min(1).max(14).default(2),
    max_per_week: z.number().int().min(0).max(7).default(3),
    review_size: z.number().int().min(1).max(8).default(3),
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
