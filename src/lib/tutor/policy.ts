import type { ActivityType, AppConfig, Persona } from "@/lib/config/schema";
import type { AdaptationReason, EvidenceRecord, Language, Modality, Pace, PolicyState } from "@/lib/tutor/types";

export type PolicyInput = {
  state: PolicyState;
  persona: Persona;
  evidence: EvidenceRecord[];
  /** Signals from the reply just evaluated. */
  last?: {
    correct: boolean;
    partial: boolean;
    hints: number;
    responseMs: number;
    replyWords: number;
    replyLanguage?: Language | "mixed";
    selfCorrected: boolean;
    overconfident: boolean;
  };
  config: AppConfig;
};

export type PolicyDecision = PolicyState & {
  /** Swap the next planned activity for this type. */
  override?: ActivityType;
  /** Add a spaced recall of this concept later in the mission. */
  revisit?: string;
  reasons: AdaptationReason[];
};

const streakNeeded: Record<AppConfig["difficulty"]["sensitivity"], number> = { high: 1, medium: 2, low: 3 };

function clamp(value: number, config: AppConfig) {
  return Math.max(config.difficulty.min, Math.min(config.difficulty.max, value));
}

/**
 * Rule table for adaptation (spec 4.6). Pure and deterministic. The LLM never decides difficulty.
 * Every change returns a human readable reason for the "Why this changed" chip.
 */
export function decide(input: PolicyInput): PolicyDecision {
  const { state, persona, evidence, last, config } = input;
  const reasons: AdaptationReason[] = [];
  let difficulty = state.difficulty;
  let pace: Pace = state.pace;
  let modality: Modality = state.modality;
  let language: Language = state.language;
  let workedExample = false;
  let override: ActivityType | undefined;
  let revisit: string | undefined;
  const need = streakNeeded[config.difficulty.sensitivity];
  const recent = evidence.slice(-Math.max(need, 2));
  const lastEvidence = evidence[evidence.length - 1];

  // Rule 1: strong evidence streak raises difficulty and shortens explanations.
  const strong = recent.length >= need && recent.slice(-need).every((item) => item.correct && item.hints === 0);
  if (last?.correct && last.hints === 0 && strong) {
    const next = clamp(difficulty + config.difficulty.step, config);
    if (next > difficulty) {
      difficulty = next;
      pace = "brisk";
      reasons.push({ code: "raise_difficulty", text: `You got the last ${need > 1 ? `${need} right` : "one right"} without hints, so I am raising the challenge to level ${difficulty}.` });
    }
  }

  // Rule 2: repeated errors or heavy hint use lowers difficulty, adds a worked example, switches to choices.
  const errorsInRow = recent.length >= 2 && recent.slice(-2).every((item) => !item.correct);
  const hintHeavy = (last?.hints ?? 0) >= 2;
  if (last && !last.correct && (errorsInRow || hintHeavy)) {
    const next = clamp(difficulty - config.difficulty.step, config);
    difficulty = next;
    pace = "gentle";
    workedExample = true;
    if (modality === "open") {
      modality = "choices";
      override = "scenario";
    }
    reasons.push({
      code: "lower_difficulty",
      text: hintHeavy
        ? "You leaned on hints there, so the next one comes with a worked example and a little less complexity."
        : "Two tricky ones in a row, so I am adding a worked example and making the next step more guided.",
    });
  }

  // Rule 3: slow and short replies suggest fatigue or low engagement. Shorten and offer choices.
  if (last && last.responseMs > 90_000 && last.replyWords > 0 && last.replyWords < 6 && pace !== "gentle") {
    pace = "brisk";
    modality = "choices";
    override = override ?? "scenario";
    reasons.push({ code: "shorten", text: "Keeping it short and giving you options to pick from, so you can move quickly." });
  }

  // Rule 4: learner writes in Roman Urdu, so the tutor follows, keeping technical terms in English.
  if (last?.replyLanguage && (last.replyLanguage === "roman_ur" || last.replyLanguage === "mixed") && language === "en" && config.language.allowed.includes("roman_ur")) {
    language = "roman_ur";
    reasons.push({ code: "language_switch", text: "Aap Roman Urdu mein likh rahe hain, to main bhi Roman Urdu mein jawab doongi. Technical terms English mein rahenge." });
  }

  // Rule 5: good recovery after a struggle returns to open questions.
  if (last?.correct && modality === "choices" && lastEvidence?.correct && evidence.slice(-3, -1).some((item) => !item.correct)) {
    modality = "open";
    reasons.push({ code: "recovered", text: "Nice recovery. Back to open questions so you can use your own words." });
  }

  // Rule 6: self correction is strong learning evidence. Keep the level and say so.
  if (last?.selfCorrected) {
    reasons.push({ code: "self_corrected", text: "You fixed that yourself, which counts for a lot. Keeping the same level." });
  }

  // Rule 7: overconfidence schedules a sneaky recall of the concept later.
  if (last?.overconfident && lastEvidence) {
    revisit = lastEvidence.concept_id;
    reasons.push({ code: "revisit", text: "I will bring this idea back once more later, so it sticks." });
  }

  // Persona constraints always apply.
  if (persona === "low_bandwidth" && pace !== "brisk") pace = "brisk";
  if (persona === "busy_rm" && pace === "normal") pace = "brisk";

  return { difficulty, pace, modality, language, worked_example: workedExample, override, revisit, reasons };
}

/** Starting state for a persona. */
export function initialPolicyState(persona: Persona, language: Language, config: AppConfig): PolicyState {
  const base = persona === "expert" ? 4 : persona === "new_joiner" ? config.learner.default_level : 3;
  return {
    difficulty: clamp(base, config),
    pace: persona === "busy_rm" || persona === "low_bandwidth" ? "brisk" : "normal",
    modality: "open",
    language,
    worked_example: false,
  };
}
