import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { normaliseToRomanUrdu } from "@/lib/voice/normalise";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Whisper fallback for browsers without Web Speech. Audio is streamed through and never stored. */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "tutor");
  if (limited) return limited;
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "Voice transcription is not configured. You can type instead." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const language = form?.get("language") === "roman_ur" ? "ur" : "en";
  if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: "No audio received" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That recording is too long. Try a shorter answer." }, { status: 413 });
  if (!/^audio\/|^video\/webm/.test(audio.type || "audio/webm")) return NextResponse.json({ error: "Unsupported audio format" }, { status: 415 });

  const started = Date.now();
  const upstream = new FormData();
  upstream.set("file", audio, "speech.webm");
  upstream.set("model", process.env.LLM_STT_MODEL ?? "whisper-large-v3-turbo");
  upstream.set("language", language);
  upstream.set("response_format", "json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: upstream,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const ok = Boolean(response?.ok);
  const raw = ok ? (((await response!.json()) as { text?: string }).text ?? "") : "";
  const text = raw ? await normaliseToRomanUrdu(raw, { requestId, userHash: auth.user.userHash }) : "";
  await logEvent({ request_id: requestId, user_hash: auth.user.userHash, type: "voice.stt", ok, latency_ms: Date.now() - started, provider: "groq", payload: { bytes: audio.size, language } });
  if (!text) return NextResponse.json({ error: "Voice did not come through. You can type instead." }, { status: 502 });
  return NextResponse.json({ text });
}
