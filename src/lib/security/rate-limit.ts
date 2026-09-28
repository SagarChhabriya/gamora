import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  reason?: "not_configured" | "unavailable";
};

type Window = `${number} ${"s" | "m" | "h" | "d"}`;

/** Named policies from architecture section 9. Tokens per window. */
export const rateLimitPolicies = {
  default: { tokens: 30, window: "1 m" },
  auth: { tokens: 10, window: "1 m" },
  upload: { tokens: 20, window: "1 h" },
  ingest_step: { tokens: 120, window: "1 m" },
  tutor: { tokens: 30, window: "1 m" },
  assistant: { tokens: 15, window: "1 m" },
  llm_daily: { tokens: 600, window: "1 d" },
} satisfies Record<string, { tokens: number; window: Window }>;

export type RateLimitPolicy = keyof typeof rateLimitPolicies;

const limiters = new Map<RateLimitPolicy, Ratelimit | null>();

function getLimiter(policy: RateLimitPolicy) {
  if (limiters.has(policy)) return limiters.get(policy) ?? null;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  const { tokens, window } = rateLimitPolicies[policy];
  const limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(tokens, window as Window),
    analytics: true,
    prefix: `gamora:rate-limit:${policy}`,
  });
  limiters.set(policy, limiter);
  return limiter;
}

export async function checkRateLimit(
  identifier: string,
  policy: RateLimitPolicy = "default",
): Promise<RateLimitResult> {
  const currentLimiter = getLimiter(policy);
  if (!currentLimiter) {
    return {
      allowed: false,
      limit: 0,
      remaining: 0,
      reset: Date.now(),
      reason: "not_configured",
    };
  }

  try {
    const result = await currentLimiter.limit(identifier);
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return {
      allowed: false,
      limit: 0,
      remaining: 0,
      reset: Date.now(),
      reason: "unavailable",
    };
  }
}

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export async function enforceRateLimit(identifier: string, policy: RateLimitPolicy) {
  const result = await checkRateLimit(`${policy}:${identifier}`, policy);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: result.reason ? "Rate limiting is unavailable, try again shortly" : "Too many requests, slow down a little" },
    {
      status: result.reason ? 503 : 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))) },
    },
  );
}
