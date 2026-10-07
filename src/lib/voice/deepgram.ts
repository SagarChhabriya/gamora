import { LLMProviderError } from "@/lib/llm/types";

const baseUrl = "https://api.deepgram.com/v1";

function deepgramKey() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new LLMProviderError("DEEPGRAM_API_KEY is not configured", "deepgram");
  return key;
}

export function deepgramConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

type ListenResponse = {
  metadata?: { duration?: number };
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
};

/**
 * Pre-recorded transcription with Nova-3, which supports Urdu ("ur"). Urdu comes back in Urdu
 * script and is normalised to Roman Urdu by the caller, as for Whisper. Audio is streamed through
 * and never stored.
 */
export async function deepgramTranscribe(input: { audio: Blob; language: "en" | "ur"; model?: string }) {
  const params = new URLSearchParams({ model: input.model ?? process.env.DEEPGRAM_STT_MODEL ?? "nova-3", language: input.language, smart_format: "true", punctuate: "true" });
  const response = await fetch(`${baseUrl}/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${deepgramKey()}`, "Content-Type": input.audio.type || "audio/webm" },
    body: input.audio,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new LLMProviderError(`deepgram listen ${response.status}: ${(await response.text()).slice(0, 200)}`, "deepgram", response.status === 429 || response.status >= 500);
  const data = (await response.json()) as ListenResponse;
  return { text: data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "", seconds: data.metadata?.duration ?? 0 };
}

/** Aura-2 speech as MP3. English voices only: Aura-2 has no Urdu voice. */
export async function deepgramSpeak(input: { text: string; voice: string }) {
  const params = new URLSearchParams({ model: input.voice, encoding: "mp3" });
  const response = await fetch(`${baseUrl}/speak?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${deepgramKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: input.text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new LLMProviderError(`deepgram speak ${response.status}: ${(await response.text()).slice(0, 200)}`, "deepgram", response.status === 429 || response.status >= 500);
  return { audio: Buffer.from(await response.arrayBuffer()), mimeType: "audio/mpeg" };
}
