/**
 * Key pool per provider. Each team member contributes their own key under their own quota:
 * GROQ_API_KEY (owner), GROQ_API_KEY_SUM, GROQ_API_KEY_EDU, GROQ_API_KEY_33, and the same pattern
 * for GEMINI_API_KEY and OPENROUTER_API_KEY.
 *
 * Keys are used as a fallback sequence, not rotated: the first key serves every request until it
 * hits a rate limit, then it rests until its window resets and the next key in the sequence takes
 * over. The order comes from LLM_KEY_ORDER (default "owner,sum,edu,33"); unlisted keys follow.
 * Logs name the contributor label only, never the key.
 */
export type PooledKey = { label: string; key: string };

const cooling = new Map<string, number>();

function sequence() {
  return (process.env.LLM_KEY_ORDER ?? "owner,sum,edu,33")
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
}

export function providerKeys(provider: string): PooledKey[] {
  const base = `${provider.toUpperCase()}_API_KEY`;
  const order = sequence();
  const rank = (label: string) => (order.includes(label) ? order.indexOf(label) : order.length);
  return Object.entries(process.env)
    .filter(([name, value]) => Boolean(value?.trim()) && (name === base || name.startsWith(`${base}_`)))
    .map(([name, value]) => ({ label: name === base ? "owner" : name.slice(base.length + 1).toLowerCase(), key: (value as string).trim() }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

/** Keys to try for one request: the sequence order, with resting keys moved to the end. */
export function keyOrder(provider: string, now = Date.now()): PooledKey[] {
  const keys = providerKeys(provider);
  const ready = keys.filter((item) => !isResting(provider, item.label, now));
  const resting = keys.filter((item) => isResting(provider, item.label, now));
  return [...ready, ...resting];
}

export function restKey(provider: string, label: string, ms: number, now = Date.now()) {
  cooling.set(`${provider}:${label}`, now + Math.min(Math.max(ms, 1_000), 120_000));
}

export function isResting(provider: string, label: string, now = Date.now()) {
  return (cooling.get(`${provider}:${label}`) ?? 0) > now;
}

/** Test helper. */
export function resetKeyPool() {
  cooling.clear();
}
