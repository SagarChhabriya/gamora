import { GeminiProvider } from "@/lib/llm/gemini";
import { GroqProvider } from "@/lib/llm/groq";
import type { GenerateRequest, GenerateResponse, LLMProvider } from "@/lib/llm/types";

const providers: Record<string, LLMProvider> = {
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
};

function configuredProvider(name: string | undefined) {
  return name ? providers[name] : undefined;
}

function modelForProvider(
  provider: LLMProvider,
  request: GenerateRequest,
): string {
  if (!request.task) return request.model;
  const task = request.task === "reasoning" ? "REASONING" : "FAST";
  return (
    process.env[`LLM_${provider.name.toUpperCase()}_${task}_MODEL`] ??
    request.model
  );
}

export async function generateWithFallback(
  request: GenerateRequest,
): Promise<GenerateResponse> {
  const names = [process.env.LLM_PRIMARY_PROVIDER, process.env.LLM_FALLBACK_PROVIDER];
  let lastError: unknown;
  for (const name of names) {
    const provider = configuredProvider(name);
    if (!provider) continue;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await provider.generate({
          ...request,
          model: modelForProvider(provider, request),
        });
      } catch (error) {
        lastError = error;
        if (attempt === 1) break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No LLM provider succeeded");
}

export function getEmbeddingProvider() {
  const primary = configuredProvider(process.env.LLM_PRIMARY_PROVIDER);
  const fallback = configuredProvider(process.env.LLM_FALLBACK_PROVIDER);
  return [primary, fallback].find((provider) => provider?.embed);
}
