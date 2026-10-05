"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth/client";
import { isSouthAsian, pickVoice } from "@/lib/voice/pick-voice";
import { splitForSpeech } from "@/lib/voice/speech-chunks";

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

/** A 0.05 s silent WAV, played inside a tap so later audio may start on phones. */
let silentUrl: string | null = null;
function silentWav() {
  if (silentUrl) return silentUrl;
  const samples = 400;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  silentUrl = URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
  return silentUrl;
}

/** Cloud voice clips already fetched this page visit, by language and text. */
const speechCache = new Map<string, Promise<string | null>>();
/** After a refusal (voice off, busy, signed out) the device voice is used for this long. */
const cloudOffUntil = { current: 0 };

function fetchSpeech(text: string, language: Language): Promise<string | null> {
  const key = `${language}:${text}`;
  const cached = speechCache.get(key);
  if (cached) return cached;
  const pending = authFetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language }) })
    .then(async (response) => {
      if (!response.ok) {
        // Off stays off for the visit; busy or rate limited tries the cloud again in a minute.
        cloudOffUntil.current = Date.now() + (response.status === 404 ? 3_600_000 : 60_000);
        speechCache.delete(key);
        return null;
      }
      return URL.createObjectURL(await response.blob());
    })
    .catch(() => {
      speechCache.delete(key);
      return null;
    });
  speechCache.set(key, pending);
  if (speechCache.size > 60) speechCache.delete(speechCache.keys().next().value as string);
  return pending;
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
  // Which voice spoke last: the cloud voice or the device's own. Null until something is spoken.
  const [engine, setEngine] = useState<"cloud" | "device" | null>(null);
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
  const ttsSupported = typeof window !== "undefined" && ("speechSynthesis" in window || typeof Audio !== "undefined");
  const generation = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!ttsSupported || !("speechSynthesis" in window)) return;
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

  /** Device speech in the most Pakistani-sounding English voice the device has (see pick-voice). */
  const browserSpeak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!("speechSynthesis" in window) || !text) {
        setSpeaking(false);
        onEnd?.();
        return;
      }
      window.speechSynthesis.cancel();
      setEngine("device");
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#>`]/g, ""));
      // A Pakistani or other South Asian English voice first, for English and Roman Urdu alike.
      const preferred = pickVoice(voices);
      if (preferred) utterance.voice = preferred;
      // Without a matching voice, ask the browser for Indian English rather than its US default.
      utterance.lang = preferred?.lang ?? "en-IN";
      utterance.rate = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        setSpeaking(false);
        onEnd?.();
      };
      // A cancelled utterance (the next one started) is not a finish, so it does not call onEnd.
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [voices],
  );

  /**
   * Speaks text. The cloud voice (Urdu and English, set by the admin) goes first, one sentence
   * group at a time with the next group fetched while the current one plays. Any failure hands the
   * rest of the text to the device voice, so read-aloud never goes silent.
   */
  const speak = useCallback(
    (text: string, options?: { onEnd?: () => void }) => {
      if (!ttsSupported || !text) return false;
      const run = ++generation.current;
      audio.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      const groups = splitForSpeech(text);
      if (!groups.length) return false;
      if (Date.now() < cloudOffUntil.current || typeof Audio === "undefined") {
        browserSpeak(text, options?.onEnd);
        return true;
      }
      // Phones only allow audio that a tap started: priming the element inside this call unlocks it.
      audio.current ??= new Audio();
      const player = audio.current;
      player.src = silentWav();
      void player.play().catch(() => undefined);
      setSpeaking(true);

      void (async () => {
        let next = fetchSpeech(groups[0], language);
        for (let index = 0; index < groups.length; index += 1) {
          const url = await next;
          if (run !== generation.current) return;
          if (!url) {
            browserSpeak(groups.slice(index).join(" "), options?.onEnd);
            return;
          }
          if (index + 1 < groups.length) next = fetchSpeech(groups[index + 1], language);
          player.src = url;
          setEngine("cloud");
          const finished = await new Promise<boolean>((resolve) => {
            player.onended = () => resolve(true);
            player.onerror = () => resolve(false);
            player.play().catch(() => resolve(false));
          });
          if (run !== generation.current) return;
          if (!finished) {
            browserSpeak(groups.slice(index).join(" "), options?.onEnd);
            return;
          }
        }
        setSpeaking(false);
        options?.onEnd?.();
      })();
      return true;
    },
    [ttsSupported, browserSpeak, language],
  );

  const silence = useCallback(() => {
    generation.current += 1;
    audio.current?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  // Hands-free needs recognition that ends on its own when the learner stops talking.
  const autoStopSupported = typeof window !== "undefined" && Boolean(recognitionCtor());

  const southAsianVoice = isSouthAsian(pickVoice(voices));

  return { listening, transcript, setTranscript, note, setNote, start, stop, speak, silence, speaking, engine, sttSupported, ttsSupported, autoStopSupported, hasVoices: voices.length > 0, southAsianVoice };
}
