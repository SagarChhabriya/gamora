import { keyOrder, restKey } from "@/lib/llm/keys";
import { LLMProviderError } from "@/lib/llm/types";
import { readJsonResponse, retryAfterMs } from "@/lib/llm/http";

const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

type InlinePart = { inlineData?: { mimeType?: string; data?: string }; text?: string };
type MediaResponse = {
  candidates?: Array<{ content?: { parts?: InlinePart[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

/**
 * One generateContent call for audio or image output, trying each pooled Gemini key in turn.
 * A rate-limited key rests until its window resets, as for text calls.
 */
async function generateMedia(model: string, body: unknown, timeoutMs: number): Promise<MediaResponse> {
  const keys = keyOrder("gemini");
  if (!keys.length) throw new LLMProviderError("GEMINI_API_KEY is not configured", "gemini");
  let last: unknown;
  for (const item of keys) {
    const response = await fetch(`${baseUrl}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": item.key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 429) {
      const text = await response.text();
      restKey("gemini", item.label, retryAfterMs(response, text) ?? 60_000);
      last = new LLMProviderError(`gemini media rate limited (429): ${text.slice(0, 200)}`, "gemini", true);
      continue;
    }
    return readJsonResponse<MediaResponse>(response, "gemini");
  }
  throw last;
}

function firstInline(data: MediaResponse) {
  return data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
}

/** Wraps 16-bit mono PCM in a WAV header so browsers can play it. */
export function pcmToWav(pcm: Buffer, rate = 24_000) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Speech for a tutor line. Roman Urdu is read with Urdu pronunciation and English terms stay
 * English, which is how Pakistani learners code-switch. The direction line is not spoken.
 */
export async function synthesiseSpeech(input: { text: string; language: "en" | "roman_ur"; voice: string; model: string }) {
  const direction =
    input.language === "roman_ur"
      ? "Read this aloud as a warm, clear Pakistani tutor. It is Urdu written in Latin letters, mixed with English terms: pronounce the Urdu words as a native Urdu speaker and keep English terms in English"
      : "Read this aloud as a warm, clear Pakistani tutor speaking English";
  const data = await generateMedia(
    input.model,
    {
      contents: [{ parts: [{ text: `${direction}: ${input.text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } } },
    },
    25_000,
  );
  const audio = firstInline(data);
  if (!audio?.data) throw new LLMProviderError("gemini returned no audio", "gemini");
  const rate = Number(audio.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24_000);
  return { wav: pcmToWav(Buffer.from(audio.data, "base64"), rate), audioTokens: data.usageMetadata?.candidatesTokenCount ?? 0, inputTokens: data.usageMetadata?.promptTokenCount ?? 0 };
}

/** One image from a Gemini image model. Returns the bytes and their media type. */
export async function generateImage(input: { prompt: string; model: string; aspectRatio?: string }) {
  const data = await generateMedia(
    input.model,
    {
      contents: [{ parts: [{ text: input.prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: input.aspectRatio ?? "3:2" } },
    },
    60_000,
  );
  const image = firstInline(data);
  if (!image?.data) throw new LLMProviderError(`gemini returned no image${data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ""}`, "gemini");
  return { bytes: Buffer.from(image.data, "base64"), mimeType: image.mimeType ?? "image/png", outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
}
