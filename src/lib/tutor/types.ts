import type { ActivityType, EvidenceSignal, Persona } from "@/lib/config/schema";

export type Language = "en" | "roman_ur";
export type Pace = "brisk" | "normal" | "gentle";
export type Modality = "open" | "choices";

export type SourceChunk = { id: string; idx: number; text: string; ref: string };

export type ExpectedPoint = { text: string; refs: string[] };

/** Full activity as stored on the server. Contains answers, never sent to the client as is. */
export type Activity = {
  id: string;
  type: ActivityType;
  concept_id: string;
  concept_name: string;
  difficulty: number;
  title: string;
  display_text: string;
  prompt: string;
  hints: string[];
  expected_points: ExpectedPoint[];
  source_chunk_ids: string[];
  options?: Array<{ id: string; text: string; correct: boolean; consequence: string }>;
  steps?: Array<{ id: string; text: string; is_error: boolean; fix?: string }>;
  items?: Array<{ id: string; text: string }>;
  roleplay?: { character: string; situation: string; opening: string; max_turns: number };
  grounded: "verified" | "unverified" | "abstained";
  worked_example?: string;
};

/** What the browser receives. Answers are removed. */
export type ClientActivity = Omit<Activity, "options" | "steps" | "items" | "expected_points"> & {
  options?: Array<{ id: string; text: string }>;
  steps?: Array<{ id: string; text: string }>;
  items?: Array<{ id: string; text: string }>;
  sources: Array<{ id: string; label: string; excerpt: string }>;
};

export type Evaluation = {
  correctness: number;
  points_hit: string[];
  points_missed: string[];
  misconception?: string;
  self_correction: boolean;
  signals: Array<{ signal: EvidenceSignal; strength: number }>;
  feedback_text: string;
  follow_up?: string;
  source_chunk_ids: string[];
  done: boolean;
};

export type EvidenceRecord = { concept_id: string; signal: EvidenceSignal; correct: boolean; hints: number; at: number };

export type AdaptationReason = { code: string; text: string };

export type PolicyState = {
  difficulty: number;
  pace: Pace;
  modality: Modality;
  language: Language;
  worked_example: boolean;
};

export type SessionState = PolicyState & {
  mission_id: string;
  journey_id: string;
  persona: Persona;
  queue: Array<{ type: ActivityType; concept_id: string; intent: string }>;
  index: number;
  current: Activity | null;
  prefetched: Activity | null;
  attempts: number;
  hints_used: number;
  roleplay_turns: Array<{ role: "learner" | "character"; text: string }>;
  evidence: EvidenceRecord[];
  asked_at: number;
  completed: boolean;
  xp_earned: number;
  reasons: AdaptationReason[];
  text_only: boolean;
};
