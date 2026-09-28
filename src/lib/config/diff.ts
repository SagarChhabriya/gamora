/** Flat list of changed leaf paths between two configs, for the version history. */
export function diffConfig(before: unknown, after: unknown, prefix = ""): Array<{ path: string; from: unknown; to: unknown }> {
  if (typeof before !== "object" || typeof after !== "object" || before === null || after === null || Array.isArray(before) || Array.isArray(after)) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: prefix, from: before, to: after }];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) =>
    diffConfig((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key),
  );
}
