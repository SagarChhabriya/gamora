import { after } from "next/server";

import { hashKey, readCache, writeCache } from "@/lib/llm/cache";
import { GeminiProvider } from "@/lib/llm/gemini";
import { GroqProvider } from "@/lib/llm/groq";
import { isResting, keyOrder, restKey } from "@/lib/llm/keys";
import { OpenRouterProvider } from "@/lib/llm/openrouter";
import {
  LLMProviderError,
  type GenerateRequest,
  type GenerateResponse,
  type LLMProvider,
} from "@/lib/llm/types";
import { reportLlm } from "@/lib/llm/notices";
import { logEvent, type EventInput } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

const providers: Record<string, LLMProvider> = {
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
  openrouter: new OpenRouterProvider(),
};

/** Rough USD per million tokens, used only for the cost estimate on dashboards. Free tier cost is zero. */
const costPerMillion: Record<string, { input: number; output: number }> = {
  groq: { input: 0.1, output: 0.5 },
  gemini: { input: 0.1, output: 0.4 },
  openrouter: { input: 0, output: 0 },
};

/** Used when a provider's model variables are not set, so a model name never crosses providers. */
const defaultModels: Record<string, { FAST: string; REASONING: string }> = {
  groq: { FAST: "openai/gpt-oss-20b", REASONING: "openai/gpt-oss-120b" },
  gemini: { FAST: "gemini-3.1-flash-lite", REASONING: "gemini-3.5-flash-lite" },
  openrouter: { FAST: "google/gemma-4-31b-it:free", REASONING: "nvidia/nemotron-3-super-120b-a12b:free" },
};

function configuredProvider(name: string | undefined) {
  return name ? providers[name] : undefined;
}

/**
 * Provider order: LLM_PROVIDER_CHAIN (for example "groq,openrouter,gemini"), else the primary and
 * fallback settings. Providers without any key are skipped.
 */
export function providerChain(skip: string[] = []) {
  const names = process.env.LLM_PROVIDER_CHAIN
    ? process.env.LLM_PROVIDER_CHAIN.split(",").map((name) =>
        name.trim().toLowerCase(),
      )
    : [process.env.LLM_PRIMARY_PROVIDER, process.env.LLM_FALLBACK_PROVIDER];
  return names
    .filter(
      (name, index): name is string =>
        Boolean(name) && names.indexOf(name) === index,
    )
    .filter((name) => !skip.includes(name))
    .map(configuredProvider)
    .filter(
      (provider): provider is LLMProvider =>
        Boolean(provider) && keyOrder(provider!.name).length > 0,
    );
}

function modelForProvider(
  provider: LLMProvider,
  request: GenerateRequest,
): string {
  if (!request.task) return request.model;
  const task = request.task === "reasoning" ? "REASONING" : "FAST";
  return (
    process.env[`LLM_${provider.name.toUpperCase()}_${task}_MODEL`] ??
    defaultModels[provider.name]?.[task] ??
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
    // A request too large for this provider is too large for its other model as well.
    let tooLarge = false;
    for (const [modelPosition, model] of modelsForProvider(provider, request).entries()) {
      if (tooLarge) break;
      const keys = keyOrder(provider.name);
      let shortestWait = Infinity;
      let waited = false;
      for (let index = 0; index < keys.length; index += 1) {
        const { key, label } = keys[index];
        // All remaining keys are resting: wait once if the window is short, else move on.
        if (isResting(provider.name, label)) {
          if (!waited && shortestWait <= 4_000) {
            waited = true;
            reportLlm("busy");
            await sleep(shortestWait + 150);
          } else if (index > 0 || keys.length > 1) continue;
        }
        const started = Date.now();
        try {
          const response = await provider.generate({
            ...request,
            model,
            apiKey: key,
          });
          // House style: no em dashes in anything a learner reads.
          const result = {
            ...response,
            text: response.text.replace(/\s*—\s*/g, ", "),
            fallbackUsed: position > 0,
            keyLabel: label,
          };
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
              key: label,
              fallback_used: position > 0,
              cost_usd: estimateCostUsd(
                provider.name,
                response.inputTokens,
                response.outputTokens,
              ),
            },
          });
          if (position > 0 || modelPosition > 0) reportLlm("backup");
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
              key: label,
              error:
                error instanceof Error
                  ? error.message.slice(0, 200)
                  : "unknown",
            },
          });
          const rateLimited =
            error instanceof LLMProviderError && /\(429\)/.test(error.message);
          if (error instanceof LLMProviderError && /\(413\)/.test(error.message)) {
            tooLarge = true;
            break;
          }
          if (rateLimited) {
            // This contributor's quota is spent for now. Rest the key and try the next one immediately.
            const wait = (error as LLMProviderError).retryAfterMs ?? 20_000;
            restKey(provider.name, label, wait);
            shortestWait = Math.min(shortestWait, wait);
            if (index === keys.length - 1 && !waited && wait <= 4_000) {
              waited = true;
              reportLlm("busy");
              await sleep(wait + 150);
              index -= 1;
            }
            continue;
          }
          const retryable =
            !(error instanceof LLMProviderError) || error.retryable;
          if (!retryable) break;
          if (index === keys.length - 1 && !waited) {
            // One short retry on a transient server error or timeout.
            waited = true;
            await sleep(400);
            index -= 1;
          }
        }
      }
    }
  }
  // The verifier failing is not something the learner needs to hear about; the content still shows.
  if (!purpose.startsWith("grounding")) reportLlm("unavailable");
  throw lastError instanceof Error
    ? lastError
    : new Error("No LLM provider succeeded");
}

export function getEmbeddingProvider() {
  return providerChain().find((provider) => provider.embed);
}
