import { after } from "next/server";

import { hashKey, readCache, writeCache } from "@/lib/llm/cache";
import { GeminiProvider } from "@/lib/llm/gemini";
import { GroqProvider } from "@/lib/llm/groq";
import {
  LLMProviderError,
  type GenerateRequest,
  type GenerateResponse,
  type LLMProvider,
} from "@/lib/llm/types";
import { logEvent, type EventInput } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

const providers: Record<string, LLMProvider> = {
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
};

/** Rough USD per million tokens, used only for the cost estimate on dashboards. Free tier cost is zero. */
const costPerMillion: Record<string, { input: number; output: number }> = {
  groq: { input: 0.1, output: 0.5 },
  gemini: { input: 0.1, output: 0.4 },
};

function configuredProvider(name: string | undefined) {
  return name ? providers[name] : undefined;
}

export function providerChain(skip: string[] = []) {
  const names = [
    process.env.LLM_PRIMARY_PROVIDER,
    process.env.LLM_FALLBACK_PROVIDER,
  ];
  return names
    .filter(
      (name, index): name is string =>
        Boolean(name) && names.indexOf(name) === index,
    )
    .filter((name) => !skip.includes(name))
    .map(configuredProvider)
    .filter((provider): provider is LLMProvider => Boolean(provider));
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

/** The task model first, then the provider's other model as a same-provider fallback. */
function modelsForProvider(
  provider: LLMProvider,
  request: GenerateRequest,
): string[] {
  const first = modelForProvider(provider, request);
  if (!request.task) return [first];
  const other = modelForProvider(provider, {
    ...request,
    task: request.task === "reasoning" ? "fast" : "reasoning",
  });
  return [...new Set([first, other].filter(Boolean))];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function estimateCostUsd(
  provider: string,
  inputTokens = 0,
  outputTokens = 0,
) {
  const rate = costPerMillion[provider];
  if (!rate) return 0;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

function record(event: EventInput) {
  const write = logEvent(event);
  try {
    after(() => write);
  } catch {
    // Outside a request scope (tests, scripts): the write is already in flight.
    void write;
  }
}

export async function generateWithFallback(
  request: GenerateRequest,
): Promise<GenerateResponse> {
  const requestId = getOrCreateRequestId(request.requestId ?? null);
  const purpose = request.purpose ?? "unspecified";
  const cacheKey = request.cacheKey
    ? hashKey(
        request.cacheKey,
        request.task ?? request.model,
        JSON.stringify(request.messages),
      )
    : undefined;

  if (cacheKey) {
    const hit = await readCache(cacheKey);
    if (hit) {
      record({
        request_id: requestId,
        user_hash: request.userHash,
        type: "llm.call",
        provider: hit.provider,
        latency_ms: 0,
        payload: { purpose, model: hit.model, cached: true },
      });
      return { ...hit, cached: true, latencyMs: 0 };
    }
  }

  const chain = providerChain(request.skipProviders);
  let lastError: unknown = new Error("No LLM provider is configured");
  for (const [position, provider] of chain.entries()) {
    for (const model of modelsForProvider(provider, request)) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await sleep(400);
        const started = Date.now();
        try {
          const response = await provider.generate({ ...request, model });
          const result = { ...response, fallbackUsed: position > 0 };
          record({
            request_id: requestId,
            user_hash: request.userHash,
            type: "llm.call",
            provider: provider.name,
            latency_ms: Math.round(response.latencyMs),
            tokens_in: response.inputTokens,
            tokens_out: response.outputTokens,
            payload: {
              purpose,
              model,
              attempt,
              fallback_used: position > 0,
              cost_usd: estimateCostUsd(
                provider.name,
                response.inputTokens,
                response.outputTokens,
              ),
            },
          });
          if (cacheKey)
            await writeCache(
              cacheKey,
              result,
              request.cacheTtlSeconds ?? 7 * 24 * 3600,
            );
          return result;
        } catch (error) {
          lastError = error;
          record({
            request_id: requestId,
            user_hash: request.userHash,
            type: "llm.call",
            provider: provider.name,
            latency_ms: Date.now() - started,
            ok: false,
            payload: {
              purpose,
              model,
              attempt,
              error:
                error instanceof Error
                  ? error.message.slice(0, 200)
                  : "unknown",
            },
          });
          const retryable =
            !(error instanceof LLMProviderError) || error.retryable;
          if (!retryable) break;
        }
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No LLM provider succeeded");
}

export function getEmbeddingProvider() {
  return providerChain().find((provider) => provider.embed);
}
