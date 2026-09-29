"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth/client";

type Language = "en" | "roman_ur";

type RecognitionResultList = ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const urduScript = /[؀-ۿ]/;

/** Urdu script from STT is normalised to Roman Urdu on the server (ADR-003, prompt B7). */
async function normalise(text: string) {
  if (!urduScript.test(text)) return text;
  const response = await authFetch("/api/voice/normalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) return text;
  return ((await response.json()) as { text?: string }).text ?? text;
}

/**
 * Voice input and output. Web Speech first, then recorded audio to the Whisper fallback route,
 * and always a text fallback. Raw audio is never stored.
 */
export function useVoice(language: Language, onText?: (text: string) => void, onFinal?: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const finalText = useRef("");
  const textListener = useRef(onText);
  const finalListener = useRef(onFinal);
  useEffect(() => {
    textListener.current = onText;
    finalListener.current = onFinal;
  }, [onText, onFinal]);
  const emit = useCallback((text: string) => {
    setTranscript(text);
    textListener.current?.(text);
  }, []);

  const sttSupported = typeof window !== "undefined" && (Boolean(recognitionCtor()) || typeof MediaRecorder !== "undefined");
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [ttsSupported]);

  const startWhisper = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      chunks.current = [];
      media.ondataavailable = (event) => chunks.current.push(event.data);
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        chunks.current = [];
        if (blob.size < 1_000) return;
        setNote("Transcribing...");
        const form = new FormData();
        form.set("audio", blob, "speech.webm");
        form.set("language", language);
        const response = await authFetch("/api/voice/stt", { method: "POST", body: form });
        const payload = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
        if (payload.text) {
          emit(payload.text);
          finalListener.current?.(payload.text);
          setNote(null);
        } else {
          setNote(payload.error ?? "Voice did not come through. You can type instead.");
        }
      };
      recorder.current = media;
      media.start();
      setListening(true);
      setNote("Recording. Tap the mic again to stop.");
    } catch {
      setNote("Microphone is not available. You can type instead.");
      setListening(false);
    }
  }, [emit, language]);

  const start = useCallback(() => {
    setNote(null);
    const Ctor = recognitionCtor();
    if (!Ctor) {
      void startWhisper();
      return;
    }
    const rec = new Ctor();
    rec.lang = language === "roman_ur" ? "ur-PK" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    finalText.current = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText.current += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      emit(`${finalText.current}${interim}`.trim());
    };
    rec.onerror = (event) => {
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setNote("Microphone permission was blocked. You can type instead.");
      else if (event.error === "language-not-supported" || event.error === "network") void startWhisper();
      else if (event.error !== "no-speech" && event.error !== "aborted") setNote("Voice did not come through. You can type instead.");
    };
    rec.onend = async () => {
      setListening(false);
      const text = finalText.current.trim();
      if (text) {
        const normalised = await normalise(text);
        emit(normalised);
        finalListener.current?.(normalised);
      } else {
        // Silence still ends a listening turn, so hands-free mode can decide what to do next.
        finalListener.current?.("");
      }
    };
    recognition.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      void startWhisper();
    }
  }, [emit, language, startWhisper]);

  const stop = useCallback(() => {
    recognition.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  /** Speaks text. Picks an ur-PK voice for Roman Urdu when available, else an English voice. */
  const speak = useCallback(
    (text: string, options?: { onEnd?: () => void }) => {
      if (!ttsSupported || !text) return false;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#>`]/g, ""));
      const preferred =
        language === "roman_ur"
          ? voices.find((voice) => voice.lang.startsWith("en-IN")) ?? voices.find((voice) => voice.lang.startsWith("en"))
          : voices.find((voice) => voice.lang === "en-US") ?? voices.find((voice) => voice.lang.startsWith("en"));
      if (preferred) utterance.voice = preferred;
      utterance.lang = preferred?.lang ?? "en-US";
      utterance.rate = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        setSpeaking(false);
        options?.onEnd?.();
      };
      // A cancelled utterance (the next one started) is not a finish, so it does not call onEnd.
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
      return true;
    },
    [language, ttsSupported, voices],
  );

  const silence = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  // Hands-free needs recognition that ends on its own when the learner stops talking.
  const autoStopSupported = typeof window !== "undefined" && Boolean(recognitionCtor());

  return { listening, transcript, setTranscript, note, setNote, start, stop, speak, silence, speaking, sttSupported, ttsSupported, autoStopSupported, hasVoices: voices.length > 0 };
}
