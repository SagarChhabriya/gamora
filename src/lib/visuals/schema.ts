import { z } from "zod";

import { viewIds, type LessonVisual } from "@/lib/visuals/views";

const text = (max: number) => z.string().trim().min(1).max(max);
const column = z.object({ label: text(60), points: z.array(text(120)).max(5) });
const level = z.enum(["low", "high"]);

/**
 * Each part is optional and parsed on its own: a malformed part is dropped, the rest of the lesson
 * stays. The model is told to include only parts the source clearly supports.
 */
export const lessonVisualSchema = z
  .object({
    figures: z
      .array(z.object({ label: text(60), value: z.coerce.number(), unit: z.string().trim().max(12).default("") }))
      .max(8)
      .optional()
      .catch(undefined),
    compare: z.object({ left: column, right: column }).optional().catch(undefined),
    overlap: z.object({ a: column, b: column, shared: z.array(text(120)).max(5) }).optional().catch(undefined),
    quadrant: z
      .object({
        x: z.object({ low: text(40), high: text(40) }),
        y: z.object({ low: text(40), high: text(40) }),
        cells: z.array(z.object({ label: text(80), x: level, y: level })).max(8),
      })
      .optional()
      .catch(undefined),
    guard: z.object({ risk: text(160), protections: z.array(text(120)).max(5) }).optional().catch(undefined),
    cycle: z.boolean().optional().catch(undefined),
    timeline: z.array(z.object({ when: text(40), what: text(120) })).max(6).optional().catch(undefined),
    chain: z.array(text(100)).max(5).optional().catch(undefined),
    best: z.enum(viewIds).optional().catch(undefined),
  })
  .partial();

/** Reads a visual block leniently. Anything unusable becomes undefined rather than an error. */
export function parseLessonVisual(raw: unknown): LessonVisual | undefined {
  const parsed = lessonVisualSchema.safeParse(raw ?? {});
  if (!parsed.success) return undefined;
  const value = parsed.data;
  // Units are normalised so "percent" and "%" are the same thing.
  const figures = value.figures?.map((figure) => ({ ...figure, unit: /^(%|percent|pc)$/i.test(figure.unit) ? "%" : figure.unit }));
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
