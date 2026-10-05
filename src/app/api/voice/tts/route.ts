import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { synthesiseSpeech } from "@/lib/media/gemini-media";
import { ttsCostUsd } from "@/lib/media/pricing";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(600),
  language: z.enum(["en", "roman_ur"]).default("en"),
});

/**
 * Cloud read-aloud: a Gemini voice that speaks Urdu and English. The browser asks for one sentence
 * group at a time and falls back to the device voice on any non-200 answer. Nothing is stored.
 */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { config } = await getActiveConfig();
  if (config.voice.engine !== "cloud") return NextResponse.json({ error: "Cloud voice is off" }, { status: 404 });
  const limited = await enforceRateLimit(auth.user.id, "tts");
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid text" }, { status: 400 });

  const model = process.env.LLM_TTS_MODEL ?? "gemini-3.8-flash-lite-tts";
  const started = Date.now();
  try {
    const speech = await synthesiseSpeech({ text: parsed.data.text.replace(/[*_#>`]/g, ""), language: parsed.data.language, voice: config.voice.cloud_voice, model });
    await logEvent({
      request_id: requestId,
      user_hash: auth.user.userHash,
      type: "voice.tts",
      latency_ms: Date.now() - started,
      provider: "gemini",
      tokens_in: speech.inputTokens,
      tokens_out: speech.audioTokens,
      payload: { model, language: parsed.data.language, chars: parsed.data.text.length, cost_usd: ttsCostUsd(model, speech.inputTokens, speech.audioTokens) },
    });
    return new Response(new Uint8Array(speech.wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    await logEvent({
      request_id: requestId,
      user_hash: auth.user.userHash,
      type: "voice.tts",
      ok: false,
      latency_ms: Date.now() - started,
      provider: "gemini",
      payload: { model, reason: String((error as Error).message ?? error).slice(0, 120) },
    });
    return NextResponse.json({ error: "Cloud voice is busy" }, { status: 503 });
  }
}
