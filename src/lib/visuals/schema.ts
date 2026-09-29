import { z } from "zod";

import { parseLenient } from "@/lib/llm/json";
import { viewIds, type LessonVisual } from "@/lib/visuals/views";

const text = (max: number) => z.string().trim().min(1).max(max);
const column = z.object({ label: text(60), points: z.array(text(120)).max(5) });
const level = z.enum(["low", "high"]);

/**
 * Each part is optional and parsed on its own: a part that runs long is trimmed, a malformed part is
 * dropped, and the rest of the lesson stays. The model is told to include only parts the source
 * clearly supports.
 */
const parts = {
  figures: z.array(z.object({ label: text(60), value: z.coerce.number(), unit: z.string().trim().max(12).default("") })).max(8),
  compare: z.object({ left: column, right: column }),
  overlap: z.object({ a: column, b: column, shared: z.array(text(120)).max(5) }),
  quadrant: z.object({
    x: z.object({ low: text(40), high: text(40) }),
    y: z.object({ low: text(40), high: text(40) }),
    cells: z.array(z.object({ label: text(80), x: level, y: level })).max(8),
  }),
  guard: z.object({ risk: text(160), protections: z.array(text(120)).max(5) }),
  cycle: z.boolean(),
  timeline: z.array(z.object({ when: text(40), what: text(120) })).max(6),
  chain: z.array(text(100)).max(5),
  best: z.enum(viewIds),
};

/** Reads a visual block leniently. Anything unusable becomes undefined rather than an error. */
export function parseLessonVisual(raw: unknown): LessonVisual | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(parts)) {
    if (source[key] === undefined || source[key] === null) continue;
    try {
      value[key] = parseLenient(schema, source[key]);
    } catch {
      // A malformed part is left out; the other views still work.
    }
  }
  // Units are normalised so "percent" and "%" are the same thing.
  const figures = (value.figures as LessonVisual["figures"])?.map((figure) => ({ ...figure, unit: /^(%|percent|pc)$/i.test(figure.unit) ? "%" : figure.unit }));
  return { ...value, figures } as LessonVisual;
}

export const visualPromptShape = `"visual": extra shapes for drawing this idea. Include ONLY the parts the source clearly supports and leave the rest out:
  "figures": [{"label","value":number,"unit":"%" or a short unit or ""}] numbers the source states, at most 6,
  "compare": {"left":{"label","points":[..]},"right":{"label","points":[..]}} when the idea contrasts two things,
  "overlap": {"a":{"label","points":[..]},"b":{"label","points":[..]},"shared":[..]} when two things share some traits,
  "quadrant": {"x":{"low","high"},"y":{"low","high"},"cells":[{"label","x":"low"|"high","y":"low"|"high"}]} when two measures sort cases,
  "guard": {"risk","protections":[..]} when the idea is a risk and what protects against it,
  "cycle": true when the steps repeat as a loop,
  "timeline": [{"when","what"}] when the source gives dates or ordered events,
  "chain": [cause, effect, outcome] when one thing leads to another,
  "best": the single view that shows this idea best, one of: ${viewIds.join(", ")}.
  Points are at most 12 words each.`;
