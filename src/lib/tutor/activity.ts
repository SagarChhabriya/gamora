import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ActivityType, AppConfig, Persona } from "@/lib/config/schema";
import { repairJson } from "@/lib/llm/json";
import { generateWithFallback } from "@/lib/llm/router";
import { tutorSystemPrompt } from "@/lib/tutor/prompts";
import { refsToIds, sourceBlock } from "@/lib/tutor/retrieval";
import type { Activity, ClientActivity, Language, Modality, Pace, SourceChunk } from "@/lib/tutor/types";

const refList = z.array(z.string()).default([]);

const baseSchema = z.object({
  title: z.string().min(1).max(120),
  display_text: z.string().min(1).max(1_500),
  prompt: z.string().min(1).max(600),
  hints: z.array(z.string().max(300)).default([]),
  expected_points: z.array(z.object({ text: z.string().max(300), refs: refList })).default([]),
  source_refs: refList,
  worked_example: z.string().max(800).optional(),
});

const optionSchema = z.object({ text: z.string().max(400), correct: z.boolean(), consequence: z.string().max(500) });
const stepSchema = z.object({ text: z.string().max(300), is_error: z.boolean(), fix: z.string().max(300).optional() });

const shapes: Record<ActivityType, string> = {
  explain_ask: `A short micro-lesson (display_text) followed by one natural open question (prompt) that asks the learner to explain or apply the idea in their own words.`,
  scenario: `A realistic workplace situation (display_text) and a decision (prompt) with exactly 3 "options". Exactly one option is correct per the source. Each option has a "consequence" that says what the source requires or warns about for that choice. Do not invent outcomes, penalties, numbers, or reactions that the source does not state; if the source is silent, say the choice does or does not follow the policy and why. Add "options":[{"text","correct":boolean,"consequence"}].`,
  spot_error: `A short story of a colleague following a procedure (display_text). Add "steps":[{"text","is_error":boolean,"fix"}] with 4 or 5 steps in order, exactly one step is wrong compared to the source, and "fix" states the correct action for that step using the source's own facts. prompt asks the learner to find the step that went wrong.`,
  ordering: `A situation where steps must happen in the right order (display_text). Add "items":["step text", ...] with 3 to 5 steps in the correct order from the source. prompt asks the learner to put them in order.`,
  roleplay: `A role-play. Add "roleplay":{"character": a realistic name and role (for example a customer), "situation": one sentence the learner sees, "opening": the character's first line, in character}. The character behaves only as the source facts allow and never reveals the correct procedure. display_text sets the scene for the learner. prompt tells the learner what to aim for.`,
  teach_back: `A friendly colleague who half understands the concept asks the learner to explain it (display_text in the colleague's voice). prompt invites the explanation. expected_points lists what a complete explanation covers.`,
  spaced_recall: `A quick story beat that makes the learner recall this earlier concept without feeling tested (display_text), then one open question (prompt).`,
  reflection: `A short, warm reflection moment (display_text) and a prompt asking how confident the learner feels about the concept and one thing they would do differently at work. expected_points can be empty.`,
};

const difficultyText = (level: number) =>
  ["very simple, everyday words", "simple and supportive", "moderate, some nuance", "challenging, includes edge cases", "expert level, tricky edge cases and exceptions"][Math.max(0, Math.min(4, level - 1))];

export async function generateActivity(input: {
  type: ActivityType;
  concept: { id: string; name: string; summary: string };
  chunks: SourceChunk[];
  difficulty: number;
  pace: Pace;
  modality: Modality;
  language: Language;
  persona: Persona;
  intent?: string;
  workedExample?: boolean;
  learnerContext?: string;
  config: AppConfig;
  requestId?: string;
  userHash?: string;
}): Promise<Activity> {
  const { type, concept, chunks, config } = input;
  try {
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
          content: `Create a ${type} activity for the concept "${concept.name}" (${concept.summary.slice(0, 200)}).
Difficulty ${input.difficulty}/5: ${difficultyText(input.difficulty)}. Pace: ${input.pace}. ${input.intent ? `Intent: ${input.intent}.` : ""}
${input.workedExample ? "The learner struggled just now. Start display_text with a short worked example from the source before the question.\n" : ""}${input.learnerContext ? `Learner context (reuse their words when helpful): ${input.learnerContext.slice(0, 300)}\n` : ""}
${shapes[type]}
Return JSON with: "title" (3 to 6 words), "display_text", "prompt", "hints" (2 hints, gentle to specific), "expected_points" ([{"text","refs":["S1"]}] what a good answer contains, each tied to a chunk ref), "source_refs" (chunk refs used), plus the type specific fields above.
Use only facts from the source chunks. Cite refs exactly as given (S1, S2...).
<source>
${sourceBlock(chunks)}
</source>`,
        },
      ],
    });
    return buildActivity(input, repairJson<Record<string, unknown>>(response.text));
  } catch {
    return fallbackActivity(input);
  }
}

function buildActivity(
  input: Parameters<typeof generateActivity>[0],
  raw: Record<string, unknown>,
): Activity {
  const base = baseSchema.parse(raw);
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

  if (type === "scenario") {
    const options = z.array(optionSchema).min(2).max(4).parse(raw.options);
    if (options.filter((option) => option.correct).length !== 1) throw new Error("Scenario needs exactly one correct option");
    activity.options = options.map((option) => ({ ...option, id: randomUUID().slice(0, 8) }));
  }
  if (type === "spot_error") {
    const steps = z.array(stepSchema).min(3).max(6).parse(raw.steps);
    if (steps.filter((step) => step.is_error).length !== 1) throw new Error("Spot the error needs exactly one wrong step");
    activity.steps = steps.map((step) => ({ ...step, id: randomUUID().slice(0, 8) }));
  }
  if (type === "ordering") {
    const items = z.array(z.string().min(1).max(300)).min(3).max(6).parse(raw.items);
    activity.items = items.map((text) => ({ id: randomUUID().slice(0, 8), text }));
  }
  if (type === "roleplay") {
    const roleplay = z
      .object({ character: z.string().max(80), situation: z.string().max(400), opening: z.string().max(500) })
      .parse(raw.roleplay);
    activity.roleplay = { ...roleplay, max_turns: 3 };
  }
  return activity;
}

/** Deterministic activity from the concept summary. Used when every provider fails. */
export function fallbackActivity(input: Parameters<typeof generateActivity>[0]): Activity {
  const { concept, chunks, language } = input;
  const ur = language === "roman_ur";
  const excerpt = chunks[0]?.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ") ?? concept.summary;
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
        ? "Apne alfaaz mein batayein, kaam par aap is ko kaise apply karenge?"
        : "In your own words, how would you apply this at work?",
    hints: [ur ? "Source ki pehli line dobara parhein." : "Re-read the first line of the source.", concept.summary.slice(0, 200)],
    expected_points: [{ text: concept.summary.slice(0, 300), refs: chunks[0] ? [chunks[0].ref] : [] }],
    source_chunk_ids: chunks.slice(0, 2).map((chunk) => chunk.id),
    grounded: "verified",
  };
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
