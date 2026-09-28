import { LLMProviderError } from "@/lib/llm/types";

export async function readJsonResponse<T>(
  response: Response,
  provider: string,
): Promise<T> {
  const body = await response.text();
  if (!response.ok) {
    throw new LLMProviderError(
      `${provider} request failed (${response.status}): ${body.slice(0, 300)}`,
      provider,
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status === 429 ? retryAfterMs(response, body) : undefined,
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new LLMProviderError(`${provider} returned invalid JSON`, provider, false);
  }
}

export function withTimeout(signal: AbortSignal | undefined, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

/** Reads the wait time from a Retry-After header or a "try again in 2.2s" message. */
export function retryAfterMs(response: Response, body: string) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1_000;
  const match = body.match(/try again in ([\d.]+)\s*(ms|s)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2].toLowerCase() === "ms" ? value : value * 1_000;
}
