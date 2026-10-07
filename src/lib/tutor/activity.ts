import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AppConfig, Persona, PlanStepType } from "@/lib/config/schema";
import { parseLenient, repairJson } from "@/lib/llm/json";
import { generateWithFallback } from "@/lib/llm/router";
import { detectLanguage } from "@/lib/ingest/language";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { languageRule, tutorSystemPrompt } from "@/lib/tutor/prompts";
import { refsToIds, sourceBlock } from "@/lib/tutor/retrieval";
import { parseLessonVisual, visualPromptShape } from "@/lib/visuals/schema";
import { groundVisual } from "@/lib/visuals/views";
import type { Activity, ClientActivity, Language, Modality, Pace, SourceChunk, StepType } from "@/lib/tutor/types";

const refList = z.array(z.string()).default([]);

const baseSchema = z.object({
  title: z.string().min(1).max(120),
  display_text: z.string().min(1).max(1_500),
  prompt: z.string().min(1).max(600),
  // Models sometimes nest hints in an extra list; flattening keeps them instead of losing the activity.
  hints: z.preprocess((value) => (Array.isArray(value) ? value.flat(3).filter((item) => typeof item === "string") : []), z.array(z.string().max(300))),
  expected_points: z.array(z.object({ text: z.string().max(300), refs: refList })).default([]),
  source_refs: refList,
  worked_example: z.string().max(800).optional(),
});

const optionSchema = z.object({ text: z.string().max(400), correct: z.boolean(), consequence: z.string().max(500) });
const stepSchema = z.object({ text: z.string().max(300), is_error: z.boolean(), fix: z.string().max(300).optional() });

const shapes: Record<PlanStepType, string> = {
  explain_ask: `A short micro-lesson (display_text) followed by one natural open question (prompt) that asks the learner to explain or apply the idea in their own words.`,
  scenario: `A realistic situation from the material's own setting (display_text) and a decision (prompt) with exactly 3 "options". Exactly one option is correct per the source. Each option has a "consequence" that says what the source requires or warns about for that choice. Do not invent outcomes, penalties, numbers, or reactions that the source does not state; if the source is silent, say the choice does or does not follow the policy and why. Add "options":[{"text","correct":boolean,"consequence"}].`,
  spot_error: `A short story of someone applying the idea step by step (display_text). Add "steps":[{"text","is_error":boolean,"fix"}] with 4 or 5 steps in order, exactly one step is wrong compared to the source, and "fix" states the correct action for that step using the source's own facts. prompt asks the learner to find the step that went wrong.`,
  ordering: `A situation where steps must happen in the right order (display_text). Add "items":["step text", ...] with 3 to 5 steps in the correct order from the source. prompt asks the learner to put them in order.`,
  roleplay: `A role-play. Add "roleplay":{"character": a realistic name and a role that fits the material (for example a friend, client, classmate or patient), "situation": one sentence the learner sees, "opening": the character's first line, in character}. The character behaves only as the source facts allow and never reveals the right answer. display_text sets the scene for the learner. prompt tells the learner what to aim for.`,
  teach_back: `A friend who half understands the concept asks the learner to explain it (display_text in the friend's voice). prompt invites the explanation. expected_points lists what a complete explanation covers.`,
  spaced_recall: `A quick story beat that makes the learner recall this earlier concept without feeling tested (display_text), then one open question (prompt). expected_points lists the facts a good recall contains.`,
  reflection: `A short, warm reflection moment (display_text) and a prompt asking how confident the learner feels about the concept and one thing they would do differently next time they use it. expected_points can be empty.`,
  capstone: `A capstone case: one realistic, compound situation from the material's own setting (display_text, up to 120 words) that can only be handled well by using ALL of the listed topics together. prompt asks the learner to say, in their own words, what they would do and why. expected_points has at least one point per topic, each tied to a chunk ref. Do not give options.`,
  crossroads: `A crossroads: the situation reaches a fork (display_text) and the learner must decide what happens next (prompt). Give exactly 3 "options", each a different path a person in the situation could take. Exactly one path follows the source. Each option's "consequence" says, in one or two sentences, where that path leads next in the situation, and whether it follows what the source requires or warns about, with no invented outcomes, penalties or numbers. Add "options":[{"text","correct":boolean,"consequence"}].`,
};

const difficultyText = (level: number) =>
  ["very simple, everyday words", "simple and supportive", "moderate, some nuance", "challenging, includes edge cases", "expert level, tricky edge cases and exceptions"][Math.max(0, Math.min(4, level - 1))];

export type ActivityInput = {
  type: StepType;
  /** summary is what a learner may see; focus is extra guidance for the model only. */
  concept: { id: string; name: string; summary: string; focus?: string };
  chunks: SourceChunk[];
  difficulty: number;
  pace: Pace;
  modality: Modality;
  language: Language;
  persona: Persona;
  intent?: string;
  workedExample?: boolean;
  learnerContext?: string;
  /** The storyboard's people and setting, so missions continue the same story. */
  storyContext?: string;
  /** What the learner's last Crossroads choice led to. The next situation picks up from there. */
  carryOver?: string;
  /** Every topic a capstone case covers. The first is concept.id. */
  conceptIds?: string[];
  /** The lesson the learner just read on this concept, when this step checks it. */
  shown?: string;
  /** Why the last attempt was rejected, so the rebuilt step avoids the same problem. */
  retryNote?: string;
  config: AppConfig;
  requestId?: string;
  userHash?: string;
};

/** True when Roman Urdu was asked for but the text came back plainly English. */
export function missedLanguage(language: Language, text: string) {
  return language === "roman_ur" && detectLanguage(text) === "en";
}

const retryInRomanUrdu = "Your previous reply was in English. Write the same JSON again with every learner-facing field in Roman Urdu.";

async function generateActivityOnce(input: ActivityInput & { type: PlanStepType }, retry: boolean): Promise<Activity> {
  const { type, concept, chunks, config } = input;
  const response = await generateWithFallback({
    task: "fast",
    model: process.env.LLM_FAST_MODEL ?? "",
    jsonMode: true,
    maxTokens: 1_800,
    timeoutMs: 15_000,
    temperature: 0.5,
    purpose: `activity.${type}`,
    requestId: input.requestId,
    userHash: input.userHash,
    messages: [
      { role: "system", content: tutorSystemPrompt({ config, persona: input.persona, language: input.language, pace: input.pace }) },
      {
        role: "user",
        content: `Create a ${type} activity for the concept "${concept.name}" (${concept.summary.slice(0, 300)}${concept.focus ? ` ${concept.focus.slice(0, 400)}` : ""}).
Difficulty ${input.difficulty}/5: ${difficultyText(input.difficulty)}. Pace: ${input.pace}. ${input.intent ? `Intent: ${input.intent}.` : ""}
${input.workedExample ? "The learner struggled just now. Start display_text with a short worked example from the source before the question.\n" : ""}${input.learnerContext ? `Learner context (reuse their words when helpful): ${input.learnerContext.slice(0, 300)}\n` : ""}${input.storyContext ? `${input.storyContext}\n` : ""}${input.carryOver ? `Continue from the learner's last decision. What it led to: ${input.carryOver.slice(0, 400)} Open display_text by picking up from that outcome, then set the new situation.\n` : ""}
${input.shown ? `The learner just read this lesson, and this step checks it: <lesson>${input.shown.slice(0, 900)}</lesson>\n` : ""}${shapes[type]}
The question must be answerable from what the learner is shown (the lesson above, display_text and any choices) together with the source. Never ask about personal experience, their job or real-life use unless the source describes it. If the source only names something, ask about what it does state.
${input.retryNote ? `${input.retryNote}\n` : ""}Return JSON with: "title" (3 to 6 words), "display_text", "prompt", "hints" (2 hints, gentle to specific), "expected_points" ([{"text","refs":["S1"]}] what a good answer contains, each tied to a chunk ref; required, at least one, for every step except reflection), "source_refs" (chunk refs used), plus the type specific fields above.
Use only facts from the source chunks. Cite refs exactly as given (S1, S2...).
<source>
${sourceBlock(chunks)}
</source>
${languageRule(input.language)}${retry ? `\n${retryInRomanUrdu}` : ""}`,
      },
    ],
  });
  return buildActivity(input, repairJson<Record<string, unknown>>(response.text));
}

/** Generates one step. Retries once when Roman Urdu was asked for and English came back. */
export async function generateActivity(input: ActivityInput): Promise<Activity> {
  try {
    let activity = await generateStep(input, false);
    if (missedLanguage(input.language, `${activity.display_text} ${activity.prompt}`)) activity = await generateStep(input, true);
    return activity;
  } catch (error) {
    // Recorded so a plain, source-quoting step can always be traced to its cause on the dashboard.
    await logEvent({
      request_id: getOrCreateRequestId(input.requestId ?? null),
      user_hash: input.userHash,
      type: "activity.fallback",
      ok: false,
      payload: { activity_type: input.type, reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
    }).catch(() => undefined);
    return fallbackActivity(input);
  }
}

function generateStep(input: ActivityInput, retry: boolean) {
  return input.type === "lesson" ? generateLesson(input, retry) : generateActivityOnce({ ...input, type: input.type }, retry);
}

const lessonSchema = z.object({
  title: z.string().min(1).max(120),
  key_idea: z.string().min(1).max(400),
  notes: z.array(z.string().min(1).max(200)).min(1).max(10),
  flow: z.array(z.string().min(1).max(120)).max(6).default([]),
  example: z.string().max(500).default(""),
  source_refs: refList,
});

const lessonPrompt = (language: Language) =>
  language === "roman_ur" ? "Samajh aa gaya? Ab ek chhota sa check karte hain." : "Got it? Next comes a quick check of what you just learned.";

/** A short visual lesson that teaches the concept before any question about it. */
async function generateLesson(input: ActivityInput, retry: boolean): Promise<Activity> {
  const { concept, chunks, config } = input;
  const response = await generateWithFallback({
    task: "fast",
    model: process.env.LLM_FAST_MODEL ?? "",
    jsonMode: true,
    maxTokens: 1_500,
    timeoutMs: 15_000,
    temperature: 0.4,
    purpose: "activity.lesson",
    requestId: input.requestId,
    userHash: input.userHash,
    messages: [
      { role: "system", content: tutorSystemPrompt({ config, persona: input.persona, language: input.language, pace: input.pace }) },
      {
        role: "user",
        content: `Teach the concept "${concept.name}" (${concept.summary.slice(0, 300)}${concept.focus ? ` ${concept.focus.slice(0, 400)}` : ""}) as a short visual lesson. This comes BEFORE any question, so teach, do not ask.
Difficulty ${input.difficulty}/5: ${difficultyText(input.difficulty)}.
${input.storyContext ? `${input.storyContext} The example may feature these people.\n` : ""}Return JSON: {"title": 3 to 6 words, "key_idea": one sentence with the single most important idea, "notes": 4 to 6 sticky notes (never fewer than 3, never more than 8), each a DIFFERENT fact from the source a beginner must remember, in at most 14 words, never just repeating the title or the key idea, "flow": if the source describes a process, sequence or cause and effect, 3 to 5 short step labels in order (at most 8 words each), otherwise [], "example": one short concrete example from the source context in at most 40 words, "source_refs": ["S1"], ${visualPromptShape}}.
Never invent a number, date or comparison the source does not state.
Use only facts from the source chunks. Cite refs exactly as given (S1, S2...).
<source>
${sourceBlock(chunks)}
</source>
${languageRule(input.language)}${retry ? `\n${retryInRomanUrdu}` : ""}`,
      },
    ],
  });
  const json = repairJson<Record<string, unknown>>(response.text);
  const raw = parseLenient(lessonSchema, json);
  // Numbers and dates are kept only when the source chunks state them.
  const visual = groundVisual(parseLessonVisual(json.visual), chunks.map((chunk) => chunk.text).join("\n"));
  const cited = refsToIds(raw.source_refs, chunks);
  const notes = lessonNotes(raw.notes, [raw.title, raw.key_idea, concept.name], chunks);
  const refs = raw.source_refs.length ? raw.source_refs : chunks.slice(0, 1).map((chunk) => chunk.ref);
  return {
    id: randomUUID(),
    type: "lesson",
    concept_id: concept.id,
    concept_name: concept.name,
    difficulty: input.difficulty,
    title: raw.title,
    display_text: raw.key_idea,
    prompt: lessonPrompt(input.language),
    hints: [],
    expected_points: notes.map((text) => ({ text, refs })),
    source_chunk_ids: cited.length ? cited : chunks.slice(0, 2).map((chunk) => chunk.id),
    grounded: "unverified",
    lesson: { key_idea: raw.key_idea, notes, flow: raw.flow.length >= 3 ? raw.flow.slice(0, 5) : [], example: raw.example, visual },
  };
}

function buildActivity(input: ActivityInput & { type: PlanStepType }, raw: Record<string, unknown>): Activity {
  const base = parseLenient(baseSchema, raw);
  const { chunks, concept, type } = input;
  const cited = refsToIds([...base.source_refs, ...base.expected_points.flatMap((point) => point.refs)], chunks);
  const activity: Activity = {
    id: randomUUID(),
    type,
    concept_id: concept.id,
    concept_name: concept.name,
    difficulty: input.difficulty,
    title: base.title,
    display_text: base.display_text,
    prompt: base.prompt,
    hints: base.hints.slice(0, 2),
    expected_points: base.expected_points.slice(0, 5),
    source_chunk_ids: cited.length ? cited : chunks.slice(0, 2).map((chunk) => chunk.id),
    grounded: "unverified",
    worked_example: base.worked_example,
  };

  if (type === "scenario" || type === "crossroads") {
    const options = parseLenient(z.array(optionSchema).min(2).max(4), raw.options);
    if (options.filter((option) => option.correct).length !== 1) throw new Error("Scenario needs exactly one correct option");
    activity.options = options.map((option) => ({ ...option, id: randomUUID().slice(0, 8) }));
  }
  if (type === "spot_error") {
    const steps = parseLenient(z.array(stepSchema).min(3).max(6), raw.steps);
    if (steps.filter((step) => step.is_error).length !== 1) throw new Error("Spot the error needs exactly one wrong step");
    activity.steps = steps.map((step) => ({ ...step, id: randomUUID().slice(0, 8) }));
  }
  if (type === "ordering") {
    const items = parseLenient(z.array(z.string().min(1).max(300)).min(3).max(6), raw.items);
    activity.items = items.map((text) => ({ id: randomUUID().slice(0, 8), text }));
  }
  if (type === "roleplay") {
    const roleplay = parseLenient(z.object({ character: z.string().max(80), situation: z.string().max(400), opening: z.string().max(500) }), raw.roleplay);
    activity.roleplay = { ...roleplay, max_turns: 3 };
  }
  if (input.conceptIds && input.conceptIds.length > 1) activity.concept_ids = input.conceptIds;
  return activity;
}

/** Deterministic activity from the concept summary. Used when every provider fails. */
export function fallbackActivity(input: ActivityInput): Activity {
  const { concept, chunks, language } = input;
  const ur = language === "roman_ur";
  // Only sentences that read like prose: citation data, markup or tables never reach the learner.
  const sentences = chunks.flatMap((chunk) => chunk.text.split(/(?<=[.!?])\s+/)).filter(isProse).slice(0, 4);
  const excerpt = sentences.length ? sentences.slice(0, 2).join(" ") : concept.summary;
  if (input.type === "lesson") {
    return {
      id: randomUUID(),
      type: "lesson",
      concept_id: concept.id,
      concept_name: concept.name,
      difficulty: input.difficulty,
      title: concept.name.slice(0, 60),
      display_text: concept.summary,
      prompt: lessonPrompt(language),
      hints: [],
      expected_points: [],
      source_chunk_ids: chunks.slice(0, 2).map((chunk) => chunk.id),
      // Built without the model: it quotes the source, so it is labelled that way.
      grounded: "abstained",
      lesson: { key_idea: concept.summary, notes: lessonNotes([], [concept.name, concept.summary], chunks), flow: [], example: "" },
    };
  }
  const reflection = input.type === "reflection";
  return {
    id: randomUUID(),
    type: reflection ? "reflection" : "explain_ask",
    concept_id: concept.id,
    concept_name: concept.name,
    difficulty: input.difficulty,
    title: concept.name.slice(0, 60),
    display_text: ur ? `Chaliye "${concept.name}" dekhte hain. Source kehta hai: ${excerpt}` : `Let us look at "${concept.name}". Your material says: ${excerpt}`,
    prompt: reflection
      ? ur
        ? `Aap "${concept.name}" ke baare mein kitna confident mehsoos karte hain, 1 se 5?`
        : `How confident do you feel about "${concept.name}", from 1 to 5?`
      : ur
        ? `Upar diye gaye hisse ke mutabiq, "${concept.name}" ke baare mein aapki material kya kehti hai? Apne alfaaz mein batayein.`
        : `According to the passage above, what does your material say about "${concept.name}"? Put it in your own words.`,
    hints: [ur ? "Source ki pehli line dobara parhein." : "Re-read the first line of the source.", concept.summary.slice(0, 200)],
    expected_points: [{ text: concept.summary.slice(0, 300), refs: chunks[0] ? [chunks[0].ref] : [] }],
    source_chunk_ids: chunks.slice(0, 2).map((chunk) => chunk.id),
    grounded: "abstained",
  };
}

const sameText = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The sticky notes of a lesson: 3 to 8 distinct facts. Notes that only repeat the title, the key idea
 * or another note are dropped. When fewer than 3 remain, sentences quoted from the source fill the
 * gap, so the notes stay grounded. Thin material gives fewer notes rather than invented ones.
 */
export function lessonNotes(notes: string[], repeats: string[], chunks: Array<{ text: string }>, min = 3, max = 8) {
  const seen = new Set(repeats.map(sameText).filter(Boolean));
  const kept: string[] = [];
  const add = (note: string) => {
    const key = sameText(note);
    if (!key || seen.has(key) || kept.length >= max) return;
    seen.add(key);
    kept.push(note.trim().slice(0, 200));
  };
  notes.forEach(add);
  if (kept.length < min) {
    const sentences = chunks.flatMap((chunk) => chunk.text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)).filter(isProse);
    for (const sentence of sentences) {
      if (kept.length >= min) break;
      add(sentence);
    }
  }
  return kept;
}

/** True for a sentence of ordinary prose: mostly letters, a sensible length, no data or markup. */
export function isProse(sentence: string) {
  const text = sentence.trim();
  if (text.length < 20 || text.length > 400) return false;
  if (/[{}<>]|":|\bhttps?:|\bwww\./.test(text)) return false;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters / text.replace(/\s/g, "").length >= 0.7;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/** Strips answers before an activity leaves the server. */
export function toClientActivity(activity: Activity, chunks: Array<{ id: string; idx: number; text: string }>): ClientActivity {
  const { options, steps, items, expected_points: _points, ...rest } = activity;
  void _points;
  const client: ClientActivity = {
    ...rest,
    sources: activity.source_chunk_ids
      .map((id) => chunks.find((chunk) => chunk.id === id))
      .filter((chunk): chunk is { id: string; idx: number; text: string } => Boolean(chunk))
      .map((chunk) => ({ id: chunk.id, label: `Source ${chunk.idx + 1}`, excerpt: chunk.text.slice(0, 280) })),
  };
  if (options) client.options = options.map(({ id, text }) => ({ id, text }));
  if (steps) client.steps = steps.map(({ id, text }) => ({ id, text }));
  if (items) client.items = shuffle(items);
  return client;
}
