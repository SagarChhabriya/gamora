import type { z } from "zod";

export function repairJson<T>(value: string): T {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (fenced) return JSON.parse(fenced) as T;

    const start = trimmed.search(/[\[{]/);
    const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
  }

  throw new Error("LLM response was not valid JSON");
}

/**
 * Parses a model reply, keeping it when it only runs long. Models often return five notes where
 * four were asked for, or a sentence a little over the limit; rejecting the whole reply for that
 * throws away a good lesson. Lists over their limit keep their first items and text is cut to its
 * limit. Any other problem (a missing field, a wrong type, too few items) still fails as before.
 */
export function parseLenient<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  // Boxed, so a reply that is itself a list can be trimmed like any nested one.
  const box: { root: unknown } = { root: structuredClone(value) };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = schema.safeParse(box.root);
    if (result.success) return result.data;
    const issues = result.error.issues;
    const tooLong = issues.filter((issue) => issue.code === "too_big" && (issue.origin === "array" || issue.origin === "string"));
    if (!tooLong.length || tooLong.length !== issues.length) throw result.error;
    for (const issue of tooLong) {
      const maximum = Number((issue as { maximum?: number | bigint }).maximum);
      const path = ["root", ...issue.path];
      if (!Number.isFinite(maximum)) throw result.error;
      let parent = box as Record<PropertyKey, unknown>;
      for (const key of path.slice(0, -1)) parent = parent[key as PropertyKey] as Record<PropertyKey, unknown>;
      const key = path[path.length - 1] as PropertyKey;
      const current = parent[key];
      if (Array.isArray(current) || typeof current === "string") parent[key] = current.slice(0, maximum);
    }
  }
  return schema.parse(box.root);
}
