"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { LessonViews } from "@/components/diagrams";
import { Button, cx } from "@/components/ui";
import { panelSeconds, type Storyboard } from "@/lib/storyboard/story";

const calm = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Narration appears word by word, unless the learner prefers reduced motion. */
function useTypedText(text: string) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (calm()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(text);
      return;
    }
    const words = text.split(" ");
    let count = 0;
    setShown("");
    const timer = window.setInterval(() => {
      count += 1;
      setShown(words.slice(0, count).join(" "));
      if (count >= words.length) window.clearInterval(timer);
    }, 70);
    return () => window.clearInterval(timer);
  }, [text]);
  return shown;
}

type Props = {
  storyboard: Storyboard;
  startHref: string;
  onFinish?: () => void;
  speak?: (text: string, options?: { onEnd?: () => void }) => boolean;
  silence?: () => void;
};

/**
 * Plays a storyboard: a strip of numbered panels, one panel on screen at a time with its drawing,
 * narration and a quote from the learner's material, then a closing card that leads into the first
 * mission. Keyboard arrows move between panels; autoplay moves on after the narration has had time.
 */
export function StoryboardPlayer({ storyboard, startHref, onFinish, speak, silence }: Props) {
  const panels = storyboard.panels;
  const total = panels.length;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [narrate, setNarrate] = useState(false);
  const closing = index >= total;
  const panel = closing ? null : panels[index];
  const typed = useTypedText(panel?.narration ?? storyboard.closing);

  const go = useCallback(
    (next: number) => {
      const target = Math.max(0, Math.min(total, next));
      setIndex(target);
      if (target >= total) {
        setPlaying(false);
        onFinish?.();
      }
    },
    [onFinish, total],
  );

  // Autoplay: with narration on, the next panel follows the end of speech; otherwise a reading timer.
  useEffect(() => {
    if (!playing || closing || !panel) return;
    if (narrate && speak) {
      const spoke = speak(`${panel.heading}. ${panel.narration}`, { onEnd: () => window.setTimeout(() => go(index + 1), 900) });
      if (spoke) return () => silence?.();
    }
    const timer = window.setTimeout(() => go(index + 1), panelSeconds(panel.narration) * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, narrate, index, closing, panel, speak, silence, go]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (event.key === "ArrowRight") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      silence?.();
      return;
    }
    if (closing) setIndex(0);
    setPlaying(true);
  }

  function toggleNarrate(on: boolean) {
    setNarrate(on);
    // Speech must start inside a tap on phones; this short line unlocks it for the panels that follow.
    if (on) speak?.(storyboard.language === "roman_ur" ? "Awaaz on hai." : "Narration on.");
    else silence?.();
  }

  return (
    <section aria-roledescription="storyboard" aria-label={storyboard.title} className="space-y-4">
      <ol className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Panels">
        {panels.map((item, position) => (
          <li key={item.topic_id} className="shrink-0">
            <button
              type="button"
              onClick={() => go(position)}
              aria-current={position === index ? "step" : undefined}
              className={cx(
                "flex min-h-11 max-w-[11rem] items-center gap-2 border px-2.5 text-left text-xs font-semibold",
                position === index ? "border-ink bg-ink text-paper" : position < index ? "border-good/60 bg-paper text-ink" : "border-ink/20 bg-paper text-ink/60",
              )}
            >
              <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px]", position < index ? "bg-good text-paper" : position === index ? "bg-paper text-ink" : "bg-ink/10")}>
                {position < index ? "✓" : position + 1}
              </span>
              <span className="truncate">{item.heading}</span>
            </button>
          </li>
        ))}
        <li className="shrink-0">
          <button
            type="button"
            onClick={() => go(total)}
            aria-current={closing ? "step" : undefined}
            className={cx("flex min-h-11 items-center gap-2 border px-2.5 text-xs font-semibold", closing ? "border-accent bg-accent text-paper" : "border-ink/20 bg-paper text-ink/60")}
          >
            ★ Your turn
          </button>
        </li>
      </ol>

      <div className="animate-rise border border-ink/20 bg-panel" key={index} aria-live="polite">
        {panel ? (
          <article>
            <header className="px-4 pt-4 sm:px-6 sm:pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                Panel {index + 1} of {total}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{panel.heading}</h2>
            </header>
            {/* Phones read the narration first, then see the drawing. Wide screens show them side by side. */}
            <div className="grid lg:grid-cols-[1.25fr_1fr]">
              <div className="order-last min-w-0 p-4 sm:p-6 lg:order-first lg:border-r lg:border-ink/15">
                <LessonViews source={{ ...panel.source, visual: { ...panel.source.visual, best: panel.view } }} label="See it as" />
              </div>
              <div className="flex min-w-0 flex-col justify-between gap-5 border-b border-ink/15 p-4 sm:p-6 lg:border-b-0">
                <div>
                  {index === 0 && storyboard.cast.length ? (
                    <ul className="mb-4 flex flex-wrap gap-2" aria-label="People in this story">
                      {storyboard.cast.map((person) => (
                        <li key={person.name} className="flex items-center gap-2 border border-ink/15 bg-paper py-1 pl-1 pr-3 text-xs">
                          <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-ink text-sm font-semibold text-paper">
                            {person.name.charAt(0)}
                          </span>
                          <span>
                            <strong>{person.name}</strong>, {person.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-lg leading-8 sm:text-xl">
                    <span className="sr-only">{panel.narration}</span>
                    <span aria-hidden="true">{typed}</span>
                  </p>
                </div>
                <blockquote className="border-l-4 border-good bg-paper px-4 py-3 text-sm leading-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-good">From your material / {panel.source_label}</p>
                  <p className="mt-1 italic">“{panel.quote}”</p>
                </blockquote>
              </div>
            </div>
          </article>
        ) : (
          <div className="p-6 text-center sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Your turn</p>
            <p className="mx-auto mt-3 max-w-xl text-2xl font-semibold leading-9 tracking-[-0.02em]">{storyboard.closing}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={startHref} className="inline-flex min-h-11 items-center bg-accent px-6 text-sm font-semibold text-paper hover:bg-ink">
                Start the first mission
              </Link>
              <Button variant="secondary" onClick={() => go(0)}>
                Watch again
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="h-1.5 w-full bg-ink/10" role="progressbar" aria-label="Storyboard progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(index, total)}>
        <div className="h-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(Math.min(index, total) / total) * 100}%` }} />
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 flex items-center gap-2 border-t border-ink/15 bg-paper/95 py-3 pl-4 pr-20 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button variant="secondary" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous panel" className="px-3">
          ◀<span className="hidden sm:inline">Back</span>
        </Button>
        <Button onClick={togglePlay} aria-pressed={playing} className="flex-1 sm:flex-none">
          {playing ? "❚❚ Pause" : closing ? "↺ Replay" : "▶ Play"}
        </Button>
        <Button variant="secondary" onClick={() => go(index + 1)} disabled={closing} aria-label="Next panel" className="px-3">
          <span className="hidden sm:inline">Next</span>▶
        </Button>
        {speak ? (
          <label className="ml-auto flex min-h-11 items-center gap-2 text-xs font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={narrate} onChange={(event) => toggleNarrate(event.target.checked)} />
            <span>🔊 <span className="hidden sm:inline">Narrate</span></span>
          </label>
        ) : null}
        <Link href={startHref} onClick={() => onFinish?.()} className="hidden min-h-11 items-center px-2 text-sm font-semibold text-ink/65 hover:text-accent sm:inline-flex">
          Skip to missions
        </Link>
      </div>
      <Link href={startHref} onClick={() => onFinish?.()} className="block text-center text-sm font-semibold text-ink/65 hover:text-accent sm:hidden">
        Skip to missions
      </Link>
    </section>
  );
}
