import { z } from "zod";

export const filterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  persona: z.string().max(40).optional(),
  language: z.enum(["en", "roman_ur"]).optional(),
  content_id: z.string().uuid().optional(),
  learner: z.string().uuid().optional(),
  cohort: z.enum(["all", "real", "demo"]).default("all"),
  reveal: z.enum(["0", "1"]).default("0"),
});

export function readFilters(url: string) {
  const params = Object.fromEntries([...new URL(url).searchParams.entries()].filter(([, value]) => value !== ""));
  return filterSchema.safeParse(params);
}
