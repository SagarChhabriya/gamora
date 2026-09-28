/**
 * Key pool per provider. Each team member contributes their own key under their own quota:
 * GROQ_API_KEY (owner), GROQ_API_KEY_SUM, GROQ_API_KEY_EDU, GROQ_API_KEY_33, and the same pattern
 * for GEMINI_API_KEY and OPENROUTER_API_KEY. Requests rotate across keys; a rate-limited key rests
 * until its window resets. Logs name the contributor label only, never the key.
 */
export type PooledKey = { label: string; key: string };

const cooling = new Map<string, number>();
const cursor = new Map<string, number>();

export function providerKeys(provider: string): PooledKey[] {
  const base = `${provider.toUpperCase()}_API_KEY`;
  return Object.entries(process.env)
    .filter(([name, value]) => Boolean(value) && (name === base || name.startsWith(`${base}_`)))
    .sort(([a], [b]) => (a === base ? -1 : b === base ? 1 : a.localeCompare(b)))
    .map(([name, value]) => ({ label: name === base ? "owner" : name.slice(base.length + 1).toLowerCase(), key: value as string }));
}

/** Keys to try for one request: rotated for an even spread, resting keys last. */
export function keyOrder(provider: string, now = Date.now()): PooledKey[] {
  const keys = providerKeys(provider);
  if (keys.length <= 1) return keys;
  const start = (cursor.get(provider) ?? 0) % keys.length;
  cursor.set(provider, start + 1);
  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const ready = rotated.filter((item) => (cooling.get(`${provider}:${item.label}`) ?? 0) <= now);
  const resting = rotated.filter((item) => (cooling.get(`${provider}:${item.label}`) ?? 0) > now);
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
  cursor.clear();
}
