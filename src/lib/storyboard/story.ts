import { availableViews, sourceStates, type ViewId, type ViewSource } from "@/lib/visuals/views";

/**
 * A storyboard: a short illustrated preview of a journey, played before the first mission. Each
 * topic gets one scene per idea it holds, so the learner meets several ideas before any question. Characters and scenery may be invented; facts may not. Each panel shows a quote
 * copied word for word from the learner's material, checked against it.
 */
export type StoryPanel = {
  topic_id: string;
  heading: string;
  narration: string;
  view: ViewId;
  source: ViewSource;
  quote: string;
  source_label: string;
  /** Generated illustration in the private media bucket. image_url is a short-lived signed link added when served. */
  image?: { path: string; alt: string };
  image_url?: string;
};

export type Storyboard = {
  title: string;
  setting: string;
  cast: Array<{ name: string; role: string }>;
  panels: StoryPanel[];
  closing: string;
  language: "en" | "roman_ur";
  generator: "llm" | "fallback";
  created_at: string;
  /** Last time illustrations were attempted, so a refused attempt (budget, billing) is not retried on every view. */
  illustrated_at?: string;
};

/** True when illustrations are on, some topic's first scene lacks one, and the last attempt was over an hour ago. */
export function needsIllustration(storyboard: Pick<Storyboard, "panels" | "illustrated_at">, imagesOn: boolean, now = Date.now()) {
  const firsts = storyboard.panels.filter((panel, index, all) => all.findIndex((other) => other.topic_id === panel.topic_id) === index);
  if (!imagesOn || firsts.every((panel) => panel.image)) return false;
  return !storyboard.illustrated_at || now - new Date(storyboard.illustrated_at).getTime() > 3_600_000;
}

function normalise(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the quote appears word for word in the source, ignoring spacing and curly quotes. */
export function quoteInSource(quote: string, sourceText: string) {
  const wanted = normalise(quote).replace(/^["'.\s]+|["'.\s]+$/g, "");
  return wanted.split(" ").length >= 4 && normalise(sourceText).includes(wanted);
}

/** The first full sentence of a chunk, trimmed to a readable length, for use as a verified quote. */
export function firstSentence(text: string, max = 220) {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.!?])\s+/).find((part) => part.split(" ").length >= 5) ?? clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : sentence;
}

/** True when every number in the text is also stated in the source. Words-only text always passes. */
export function numbersStated(text: string, sourceText: string) {
  const numbers = text.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((number) => sourceStates(Number(number), sourceText));
}

/** The view a panel opens on: the model's pick when the panel has data for it, else the best fit. */
export function panelView(source: ViewSource, wanted?: string): ViewId {
  const views = availableViews(source);
  if (wanted && (views as string[]).includes(wanted)) return wanted as ViewId;
  const preferred: ViewId[] = ["share_split", "trend_bars", "key_figure", "side_by_side", "cause_chain", "guardrails", "loop", "sequence", "milestones", "overlap", "quadrant", "branch_tree", "flow", "notes"];
  return preferred.find((view) => views.includes(view)) ?? "notes";
}

/** Varies the drawings: when two panels in a row would use the same view, the second takes another one it supports. */
export function varyViews(panels: StoryPanel[]): StoryPanel[] {
  return panels.map((panel, index, all) => {
    const previous = index > 0 ? all[index - 1].view : null;
    if (panel.view !== previous) return panel;
    const other = availableViews(panel.source).find((view) => view !== previous && view !== "notes");
    return other ? { ...panel, view: other } : panel;
  });
}

/** Seconds a panel stays on screen when playing: enough to read the narration at an easy pace. */
export function panelSeconds(narration: string) {
  const words = narration.split(/\s+/).filter(Boolean).length;
  return Math.max(6, Math.min(16, Math.round(words * 0.45)));
}

/** Browser storage key that remembers a learner already watched this journey's storyboard. */
export const storyboardSeenKey = (journeyId: string) => `gamora.storyboard.seen.${journeyId}`;

/**
 * One line that keeps missions inside the storyboard's world: the same people and setting. It names
 * people only; facts still come from the source chunks of each activity.
 */
export function storyContextFor(storyboard: Pick<Storyboard, "setting" | "cast"> | undefined | null) {
  if (!storyboard?.cast?.length) return undefined;
  const cast = storyboard.cast.map((person) => `${person.name} (${person.role})`).join(", ");
  return `The learner watched a storyboard set in: ${storyboard.setting} People in it: ${cast}. When a situation needs a person, use one of these people and this setting, so the missions continue the same story.`;
}
