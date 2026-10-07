import type { AppConfig } from "@/lib/config/schema";

export type SpeechProvider = "gemini" | "deepgram";
export type SttProvider = "groq" | "deepgram";

type Keys = { gemini: boolean; deepgram: boolean; groq: boolean };

/**
 * Cloud voices to try, in order, for one line. The admin's choice goes first. Deepgram has no Urdu
 * voice, so a Roman Urdu line never goes to it. The other provider is tried only when the admin
 * turned the backup on. An empty list means the device voice speaks.
 */
export function speechOrder(voice: AppConfig["voice"], language: "en" | "roman_ur", keys: Pick<Keys, "gemini" | "deepgram">): SpeechProvider[] {
  if (voice.engine === "browser") return [];
  const canSpeak = (provider: SpeechProvider) => keys[provider] && (provider === "gemini" || language === "en");
  const chosen: SpeechProvider = voice.engine === "deepgram" ? "deepgram" : "gemini";
  const other: SpeechProvider = chosen === "gemini" ? "deepgram" : "gemini";
  // With Deepgram chosen, Roman Urdu lines still need a voice that speaks Urdu, so Gemini serves them.
  const urduReroute = chosen === "deepgram" && language === "roman_ur";
  const order = [chosen, ...(voice.cloud_backup || urduReroute ? [other] : [])];
  return order.filter(canSpeak);
}

/** Server transcribers to try, in order: the admin's choice, then the other one when the backup is on. */
export function sttOrder(voice: AppConfig["voice"], keys: Pick<Keys, "groq" | "deepgram">): SttProvider[] {
  const chosen = voice.stt_provider;
  const other: SttProvider = chosen === "groq" ? "deepgram" : "groq";
  return [chosen, ...(voice.cloud_backup ? [other] : [])].filter((provider) => keys[provider]);
}
