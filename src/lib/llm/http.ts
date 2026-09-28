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
