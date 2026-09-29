import type { ClientActivity, SessionState } from "@/lib/tutor/types";

type Queue = SessionState["queue"];

const afterLessonIntent = "check understanding of the lesson the learner just read; keep display_text to one short sentence and do not re-teach it";

/**
 * Learn first, then practise: the first time a concept appears in a mission, a lesson step teaches
 * it and the next step checks it. Recall and reflection steps never get a lesson of their own.
 */
export function withLessons(queue: Queue): Queue {
  const taught = new Set(queue.filter((item) => item.type === "lesson").map((item) => item.concept_id));
  const result: Queue = [];
  for (const item of queue) {
    // A capstone case draws on topics taught in earlier missions, so it never gets a lesson of its own.
    if (item.type !== "lesson" && item.type !== "spaced_recall" && item.type !== "reflection" && item.type !== "capstone" && !taught.has(item.concept_id)) {
      taught.add(item.concept_id);
      result.push({ type: "lesson", concept_id: item.concept_id, intent: "teach before any question" });
      result.push({ ...item, intent: afterLessonIntent });
      continue;
    }
    result.push(item);
  }
  return result;
}

const forkable = new Set(["scenario", "spot_error", "ordering", "roleplay"]);

/**
 * At most one Crossroads per mission, so choices stay the exception and never feel like a quiz. It
 * replaces the first practice step that comes after the learner has already answered something,
 * and it is never the check that directly follows a lesson.
 */
export function withCrossroads(queue: Queue): Queue {
  if (queue.some((item) => item.type === "crossroads")) return queue;
  const answered = (index: number) => queue.slice(0, index).some((item) => item.type !== "lesson");
  const at = queue.findIndex((item, index) => forkable.has(item.type) && answered(index) && queue[index - 1]?.type !== "lesson");
  if (at < 0) return queue;
  return queue.map((item, index) => (index === at ? { ...item, type: "crossroads" as const, intent: "a fork in the situation; the learner's path shapes what happens next" } : item));
}

export type StepKind = "lesson" | "question";

export function stepKinds(queue: Queue): StepKind[] {
  return queue.map((item) => (item.type === "lesson" ? "lesson" : "question"));
}

export type Position = { index: number; total: number; steps?: StepKind[] };

type Sources = ClientActivity["sources"];

export type HistoryItem =
  | { kind: "activity"; activity: ClientActivity; position: Position }
  | { kind: "learner"; text: string }
  | { kind: "feedback"; text: string; correctness: number; sources: Sources; follow_up?: string }
  | { kind: "character"; text: string; name: string }
  | { kind: "hint"; text: string }
  | { kind: "answer"; text: string; sources: Sources; abstained: boolean };

export type TurnRow = { role: string; activity_type: string | null; content: Record<string, unknown> | null; source_chunk_ids: string[] | null };

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** What the learner picked or wrote, in words, so a replayed conversation reads like the original. */
function learnerLabel(content: Record<string, unknown>, activity: ClientActivity | undefined) {
  const confidence = typeof content.confidence === "number" ? `Confidence ${content.confidence}/5.` : "";
  let label = str(content.reply) || str(content.question);
  const choice = str(content.choice_id);
  if (!label && choice) label = activity?.options?.find((option) => option.id === choice)?.text ?? activity?.steps?.find((step) => step.id === choice)?.text ?? "";
  if (!label && Array.isArray(content.order)) {
    label = content.order.map((id, index) => `${index + 1}. ${activity?.items?.find((item) => item.id === id)?.text ?? ""}`).join(" ");
  }
  return [confidence, label].filter(Boolean).join(" ");
}

/** Rebuilds the visible conversation of a session from its stored turns, in order. */
export function historyFromTurns(turns: TurnRow[], sourcesFor: (ids: string[]) => Sources): HistoryItem[] {
  const items: HistoryItem[] = [];
  let activity: ClientActivity | undefined;
  for (const turn of turns) {
    const content = turn.content ?? {};
    const type = turn.activity_type ?? "";
    const ids = turn.source_chunk_ids ?? [];
    if (turn.role === "assistant" && content.activity) {
      activity = content.activity as ClientActivity;
      const position = (content.position as Position | undefined) ?? { index: 0, total: 0 };
      items.push({ kind: "activity", activity, position });
    } else if (turn.role === "assistant" && type === "hint") {
      items.push({ kind: "hint", text: str(content.hint) });
    } else if (turn.role === "assistant" && type === "ask") {
      items.push({ kind: "answer", text: str(content.answer), sources: sourcesFor(ids), abstained: Boolean(content.abstained) });
    } else if (turn.role === "assistant" && type.endsWith(".feedback")) {
      if (content.character) items.push({ kind: "character", text: str(content.feedback), name: str(content.character) });
      else {
        items.push({
          kind: "feedback",
          text: str(content.feedback),
          correctness: typeof content.correctness === "number" ? content.correctness : 0,
          sources: sourcesFor(ids),
          follow_up: str(content.follow_up) || undefined,
        });
      }
    } else if (turn.role === "learner") {
      const text = learnerLabel(content, activity);
      if (text) items.push({ kind: "learner", text });
    }
  }
  return items;
}
