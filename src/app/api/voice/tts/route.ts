import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { keyOrder } from "@/lib/llm/keys";
import { synthesiseSpeech } from "@/lib/media/gemini-media";
import { deepgramTtsCostUsd, ttsCostUsd } from "@/lib/media/pricing";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { deepgramConfigured, deepgramSpeak } from "@/lib/voice/deepgram";
import { speechOrder, type SpeechProvider } from "@/lib/voice/providers";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(600),
  language: z.enum(["en", "roman_ur"]).default("en"),
});

/**
 * Cloud read-aloud. Gemini speaks Urdu and English; Deepgram Aura-2 speaks English only. The admin
 * picks one, and may let the other take over when it fails. The browser asks for one sentence
 * group at a time and falls back to the device voice on any non-200 answer. Nothing is stored.
 */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { config } = await getActiveConfig();
  if (config.voice.engine === "browser") return NextResponse.json({ error: "Cloud voice is off" }, { status: 404 });
  const limited = await enforceRateLimit(auth.user.id, "tts");
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid text" }, { status: 400 });

  const text = parsed.data.text.replace(/[*_#>`]/g, "");
  const providers = speechOrder(config.voice, parsed.data.language, { gemini: keyOrder("gemini").length > 0, deepgram: deepgramConfigured() });
  for (const provider of providers) {
    const audio = await speakWith(provider, text, config.voice, { requestId, userHash: auth.user.userHash, language: parsed.data.language });
    if (audio) return new Response(new Uint8Array(audio.bytes), { headers: { "Content-Type": audio.mimeType, "Cache-Control": "private, max-age=3600" } });
  }
  return NextResponse.json({ error: "Cloud voice is busy" }, { status: 503 });
}

async function speakWith(
  provider: SpeechProvider,
  text: string,
  voice: Awaited<ReturnType<typeof getActiveConfig>>["config"]["voice"],
  context: { requestId: string; userHash: string; language: string },
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const started = Date.now();
  const model = provider === "deepgram" ? voice.deepgram_voice : (process.env.LLM_TTS_MODEL ?? "gemini-3.8-flash-lite-tts");
  try {
    if (provider === "deepgram") {
      const speech = await deepgramSpeak({ text, voice: voice.deepgram_voice });
      await logEvent({
        request_id: context.requestId,
        user_hash: context.userHash,
        type: "voice.tts",
        latency_ms: Date.now() - started,
        provider,
        payload: { model, language: context.language, chars: text.length, cost_usd: deepgramTtsCostUsd(text.length) },
      });
      return { bytes: speech.audio, mimeType: speech.mimeType };
    }
    const speech = await synthesiseSpeech({ text, voice: voice.cloud_voice, model });
    await logEvent({
      request_id: context.requestId,
      user_hash: context.userHash,
      type: "voice.tts",
      latency_ms: Date.now() - started,
      provider,
      tokens_in: speech.inputTokens,
      tokens_out: speech.audioTokens,
      payload: { model, language: context.language, chars: text.length, cost_usd: ttsCostUsd(model, speech.inputTokens, speech.audioTokens) },
    });
    return { bytes: speech.wav, mimeType: "audio/wav" };
  } catch (error) {
    await logEvent({
      request_id: context.requestId,
      user_hash: context.userHash,
      type: "voice.tts",
      ok: false,
      latency_ms: Date.now() - started,
      provider,
      payload: { model, reason: String((error as Error).message ?? error).slice(0, 120) },
    });
    return null;
  }
}
