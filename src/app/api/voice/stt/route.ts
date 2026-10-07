import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { deepgramSttCostUsd } from "@/lib/media/pricing";
import { normaliseToRomanUrdu } from "@/lib/voice/normalise";
import { deepgramConfigured, deepgramTranscribe } from "@/lib/voice/deepgram";
import { sttOrder } from "@/lib/voice/providers";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

async function groqTranscribe(audio: File, language: "en" | "ur") {
  const upstream = new FormData();
  upstream.set("file", audio, "speech.webm");
  upstream.set("model", process.env.LLM_STT_MODEL ?? "whisper-large-v3-turbo");
  upstream.set("language", language);
  upstream.set("response_format", "json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: upstream,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`groq stt ${response.status}`);
  return ((await response.json()) as { text?: string }).text?.trim() ?? "";
}

/** Whether push to talk should record for the server even when the browser can listen itself. */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { config } = await getActiveConfig();
  const available = sttOrder(config.voice, { groq: Boolean(process.env.GROQ_API_KEY), deepgram: deepgramConfigured() }).length > 0;
  return NextResponse.json({ server_first: available && config.voice.stt_server_first });
}

/**
 * Server transcription: Groq Whisper or Deepgram Nova-3, as the admin chose, with the other as an
 * optional backup. Used when the browser has no speech recognition, or always when the admin
 * prefers it. Audio is streamed through and never stored.
 */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "tutor");
  if (limited) return limited;
  const { config } = await getActiveConfig();
  const providers = sttOrder(config.voice, { groq: Boolean(process.env.GROQ_API_KEY), deepgram: deepgramConfigured() });
  if (!providers.length) return NextResponse.json({ error: "Voice transcription is not configured. You can type instead." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const language = form?.get("language") === "roman_ur" ? "ur" : "en";
  if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: "No audio received" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That recording is too long. Try a shorter answer." }, { status: 413 });
  if (!/^audio\/|^video\/webm/.test(audio.type || "audio/webm")) return NextResponse.json({ error: "Unsupported audio format" }, { status: 415 });

  let raw = "";
  for (const provider of providers) {
    const started = Date.now();
    let seconds = 0;
    try {
      if (provider === "deepgram") {
        const result = await deepgramTranscribe({ audio, language });
        raw = result.text;
        seconds = result.seconds;
      } else {
        raw = await groqTranscribe(audio, language);
      }
    } catch {
      raw = "";
    }
    await logEvent({
      request_id: requestId,
      user_hash: auth.user.userHash,
      type: "voice.stt",
      ok: Boolean(raw),
      latency_ms: Date.now() - started,
      provider,
      payload: { bytes: audio.size, language, ...(provider === "deepgram" && seconds ? { seconds, cost_usd: deepgramSttCostUsd(seconds) } : {}) },
    });
    if (raw) break;
  }
  const text = raw ? await normaliseToRomanUrdu(raw, { requestId, userHash: auth.user.userHash }) : "";
  if (!text) return NextResponse.json({ error: "Voice did not come through. You can type instead." }, { status: 502 });
  return NextResponse.json({ text });
}
