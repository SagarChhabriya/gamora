import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  reason?: "not_configured" | "unavailable";
};

let limiter: Ratelimit | null | undefined;

function getLimiter() {
  if (limiter !== undefined) return limiter;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    limiter = null;
    return limiter;
  }

  limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    analytics: true,
    prefix: "gamora:rate-limit",
  });
  return limiter;
}

export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  const currentLimiter = getLimiter();
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
