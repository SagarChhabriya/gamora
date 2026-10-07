"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Voice = {
  speak: (text: string, options?: { onEnd?: () => void }) => boolean;
  silence: () => void;
  start: (options?: { autoStop?: boolean }) => void;
  stop: () => void;
};

const MAX_SILENT_TURNS = 2;

/**
 * Hands-free: read every tutor message aloud in order, then listen; what the learner says is handed
 * to the page to act on; then it reads the reply and listens again. Two silent turns in a row pause
 * it, so a phone left on a table does not keep listening.
 */
export function useHandsFree(voice: Voice) {
  const [on, setOn] = useState(false);
  const [paused, setPaused] = useState<string | null>(null);
  const voiceRef = useRef(voice);
  const onRef = useRef(false);
  const busyRef = useRef(false);
  const playing = useRef(false);
  const queue = useRef<string[]>([]);
  const last = useRef("");
  const silentTurns = useRef(0);
  const playNextRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const listen = useCallback(() => {
    if (onRef.current && !busyRef.current && !playing.current) voiceRef.current.start({ autoStop: true });
  }, []);

  useEffect(() => {
    playNextRef.current = () => {
      const next = queue.current.shift();
      if (next === undefined) {
        playing.current = false;
        listen();
        return;
      }
      playing.current = true;
      last.current = next;
      if (!voiceRef.current.speak(next, { onEnd: () => playNextRef.current() })) {
        playing.current = false;
        queue.current = [];
      }
    };
  }, [listen]);

  /** Queues a message to be read aloud. Listening starts once the queue is empty. */
  const say = useCallback((text: string) => {
    if (!onRef.current || !text.trim()) return;
    queue.current.push(text);
    if (!playing.current) playNextRef.current();
  }, []);

  const turnStarted = useCallback(() => {
    busyRef.current = true;
    voiceRef.current.stop();
  }, []);

  const turnEnded = useCallback(() => {
    busyRef.current = false;
    listen();
  }, [listen]);

  /** Call with each finished transcript. Returns the words to act on, or null for silence. */
  const heard = useCallback(
    (text: string) => {
      if (!onRef.current) return null;
      if (text.trim()) {
        silentTurns.current = 0;
        return text;
      }
      silentTurns.current += 1;
      if (silentTurns.current > MAX_SILENT_TURNS) {
        onRef.current = false;
        setOn(false);
        setPaused("Hands-free paused after a quiet moment. Turn it on again when you are ready.");
      } else {
        window.setTimeout(listen, 400);
      }
      return null;
    },
    [listen],
  );

  const repeat = useCallback(() => say(last.current), [say]);

  const enable = useCallback((value: boolean, greeting?: string) => {
    onRef.current = value;
    setOn(value);
    setPaused(null);
    silentTurns.current = 0;
    queue.current = [];
    playing.current = false;
    if (!value) {
      voiceRef.current.stop();
      voiceRef.current.silence();
      return;
    }
    // This runs inside the tap that switched it on, which unlocks speech on phones.
    if (greeting) {
      queue.current.push(greeting);
      playNextRef.current();
    }
  }, []);

  return { on, paused, say, heard, repeat, enable, turnStarted, turnEnded };
}
