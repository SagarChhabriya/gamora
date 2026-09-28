import { createHash } from "node:crypto";

import { Redis } from "@upstash/redis";

import type { GenerateResponse } from "@/lib/llm/types";

let redis: Redis | null | undefined;

function getRedis() {
  if (redis !== undefined) return redis;
  redis =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
      ? Redis.fromEnv()
      : null;
  return redis;
}

export function hashKey(...parts: string[]) {
  return createHash("sha256").update(parts.join("␟")).digest("hex");
}

export async function readCache(key: string): Promise<GenerateResponse | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    return (await client.get<GenerateResponse>(`gamora:llm:${key}`)) ?? null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: GenerateResponse, ttlSeconds: number) {
  const client = getRedis();
  if (!client) return;
  try {
    await client.set(`gamora:llm:${key}`, value, { ex: ttlSeconds });
  } catch {
    // Cache failures never block a learner turn.
  }
}
