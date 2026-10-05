/**
 * Media prices and the image cost evaluator. Prices are Gemini API pay-as-you-go list prices
 * checked on 2026-10-05 (ai.google.dev/gemini-api/docs/pricing); they feed dashboard estimates and
 * the budget guard, never billing.
 *
 * The evaluator follows dev-docs/image-generation-cost-struct.md: estimate the cost of a request,
 * pick the cheapest tier that fits the purpose, count a cache hit as free, and report what the
 * spend means per learner so the margin question has an answer.
 */

export type ImageTier = "economy" | "standard";

export const imageModels: Record<ImageTier, { model: string; usdPerImage: number; label: string }> = {
  // Gemini 3.1 Flash Lite Image: $30 per 1M output tokens, about 1,120 tokens for a 1K image.
  economy: { model: "gemini-3.1-flash-lite-image", usdPerImage: 0.0336, label: "Gemini 3.1 Flash Lite Image" },
  // Gemini 3.1 Flash Image at 512 px: $60 per 1M output tokens.
  standard: { model: "gemini-3.1-flash-image", usdPerImage: 0.045, label: "Gemini 3.1 Flash Image" },
};

/** Gemini TTS: price per 1M output audio tokens (25 tokens per second of audio) and per 1M input text tokens. */
export const ttsPrices: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash-lite-tts": { input: 0.5, output: 6 },
  "gemini-3.8-flash-tts": { input: 0.5, output: 9 },
  "gemini-2.5-flash-preview-tts": { input: 0.5, output: 10 },
};

export function ttsCostUsd(model: string, inputTokens: number, audioTokens: number) {
  const price = ttsPrices[model] ?? ttsPrices["gemini-3.8-flash-tts"];
  return (inputTokens * price.input + audioTokens * price.output) / 1_000_000;
}

export type ImageRequest = {
  /** Tier chosen by the admin. */
  tier: ImageTier;
  /** Images already stored for this exact prompt cost nothing to show again. */
  cached: boolean;
  /** Spend so far this calendar month and the admin's monthly budget. */
  monthSpendUsd: number;
  monthlyBudgetUsd: number;
  /** Images already made for this source and the admin cap per source. */
  sourceImages: number;
  maxPerSource: number;
  /** Learners expected to see this source, for the per-learner figure. At least 1. */
  expectedLearners?: number;
};

export type ImagePlan =
  | { generate: false; reason: "cached" | "budget" | "source_cap" | "off"; model?: string; estimatedCostUsd: 0; costPerLearnerUsd: 0 }
  | { generate: true; reason: "ok"; model: string; tier: ImageTier; estimatedCostUsd: number; costPerLearnerUsd: number };

/** Decides whether to generate an image now, with which model, and what it costs. */
export function planImage(request: ImageRequest): ImagePlan {
  if (request.cached) return { generate: false, reason: "cached", estimatedCostUsd: 0, costPerLearnerUsd: 0 };
  if (request.maxPerSource <= 0 || request.monthlyBudgetUsd <= 0) return { generate: false, reason: "off", estimatedCostUsd: 0, costPerLearnerUsd: 0 };
  if (request.sourceImages >= request.maxPerSource) return { generate: false, reason: "source_cap", estimatedCostUsd: 0, costPerLearnerUsd: 0 };
  const tier = request.tier;
  const choice = imageModels[tier];
  // A request that would cross the budget is refused rather than allowed to overshoot.
  if (request.monthSpendUsd + choice.usdPerImage > request.monthlyBudgetUsd) return { generate: false, reason: "budget", estimatedCostUsd: 0, costPerLearnerUsd: 0 };
  const learners = Math.max(1, request.expectedLearners ?? 1);
  return {
    generate: true,
    reason: "ok",
    model: choice.model,
    tier,
    estimatedCostUsd: choice.usdPerImage,
    costPerLearnerUsd: Number((choice.usdPerImage / learners).toFixed(6)),
  };
}

/** What illustrating one source costs, for the admin hint and the deck: panels x price, paid once. */
export function sourceImageCost(panels: number, tier: ImageTier, learners = 1) {
  const total = panels * imageModels[tier].usdPerImage;
  return { totalUsd: Number(total.toFixed(4)), perLearnerUsd: Number((total / Math.max(1, learners)).toFixed(6)) };
}
