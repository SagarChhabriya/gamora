import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { generateWithFallback, providerChain } from "@/lib/llm/router";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  simulate_primary_outage: z.boolean().default(false),
  /** Test one provider on its own, for example "openrouter". */
  only_provider: z.enum(["groq", "gemini", "openrouter"]).optional(),
});

/** Outage drill: proves the fallback provider answers when the primary is unavailable. */
export async function POST(request: Request) {
  const auth = await requireUser(request, "admin");
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "default");
  if (limited) return limited;

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const primary = process.env.LLM_PRIMARY_PROVIDER;
  const chain = providerChain().map((provider) => provider.name);
  const skip = body.data.only_provider
    ? chain.filter((name) => name !== body.data.only_provider)
    : body.data.simulate_primary_outage
      ? [chain[0] ?? primary ?? ""]
      : [];
  try {
    const result = await generateWithFallback({
      task: "fast",
      model: process.env.LLM_FAST_MODEL ?? "",
      purpose: "admin.llm_check",
      requestId: getOrCreateRequestId(request.headers.get("x-request-id")),
      userHash: auth.user.userHash,
      skipProviders: skip,
      maxTokens: 300,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    return NextResponse.json({
      chain: providerChain().map((provider) => provider.name),
      simulated_outage: skip,
      served_by: result.provider,
      key: result.keyLabel,
      model: result.model,
      latency_ms: result.latencyMs,
      fallback_used: result.fallbackUsed || skip.length > 0,
      reply: result.text.slice(0, 40),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message.slice(0, 200) : "All providers failed", simulated_outage: skip },
      { status: 502 },
    );
  }
}
