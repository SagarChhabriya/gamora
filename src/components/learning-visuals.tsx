"use client";

import { useState } from "react";

import { LessonViews } from "@/components/diagrams";
import { Button, cx } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import type { ClientActivity } from "@/lib/tutor/types";

/** Tap-to-listen. A tap is a user gesture, which mobile browsers require before speech plays. */
export function ListenButton({ text, onListen, className }: { text: string; onListen?: (text: string) => void; className?: string }) {
  if (!onListen) return null;
  return (
    <button
      type="button"
      onClick={() => onListen(text)}
      className={cx("inline-flex min-h-9 items-center gap-1.5 border border-ink/20 bg-paper px-2.5 text-xs font-semibold text-ink/75 hover:border-accent hover:text-accent", className)}
      aria-label="Listen to this"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
      </svg>
      Listen
    </button>
  );
}

/**
 * Learn first: key idea, then the lesson drawn in the view that fits it best (notes, flow or one of
 * the diagram views), with a switcher for every other view its data supports, then an example.
 */
export function LessonCard({
  activity,
  active,
  busy,
  onContinue,
  onListen,
}: {
  activity: ClientActivity;
  active: boolean;
  busy?: boolean;
  onContinue?: () => void;
  onListen?: (text: string) => void;
}) {
  const lesson = activity.lesson;
  const spoken = [lesson?.key_idea ?? activity.display_text, ...(lesson?.notes ?? []), ...(lesson?.flow ?? []), lesson?.example ?? ""].filter(Boolean).join(". ");
  const body = (
    <div className="space-y-5">
      <div className="flex gap-3 border-l-4 border-accent bg-paper p-4">
        <span aria-hidden="true" className="text-2xl leading-none">
          💡
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Key idea</p>
          <p className="mt-1 text-lg font-semibold leading-7">{lesson?.key_idea ?? activity.display_text}</p>
        </div>
      </div>
      {lesson ? <LessonViews source={lesson} /> : null}
      {lesson?.example ? (
        <div className="border border-dashed border-ink/35 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Example</p>
          <p className="mt-1 leading-7">{lesson.example}</p>
        </div>
      ) : null}
    </div>
  );

  if (!active) {
    return (
      <details className="border border-ink/10 bg-panel/60 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">📖 Lesson: {activity.title}</summary>
        <div className="mt-4">{body}</div>
      </details>
    );
  }

  return (
    <article className="animate-rise border border-ink/20 bg-panel p-5 sm:p-6" aria-labelledby={`lesson-${activity.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="bg-good px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-paper">📖 Learn</span>
        <ListenButton text={`${activity.title}. ${spoken}`} onListen={onListen} />
      </div>
      <h2 id={`lesson-${activity.id}`} className="mt-3 text-2xl font-semibold tracking-[-0.02em]">
        {activity.title}
      </h2>
      <div className="mt-4">{body}</div>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ink/15 pt-4">
        <Button onClick={onContinue} disabled={busy || !onContinue}>
          Got it, check my understanding
        </Button>
        <span className="text-sm text-ink/60">{activity.prompt}</span>
      </div>
      <SourcesInline sources={activity.sources} />
    </article>
  );
}

function SourcesInline({ sources }: { sources: ClientActivity["sources"] }) {
  if (!sources.length) return null;
  return <p className="mt-3 text-xs text-ink/55">From your material: {sources.map((source) => source.label).join(", ")}</p>;
}

/** Where the learner is in the mission: a trail of lesson and question steps. */
export function StepTrail({ steps, index }: { steps: Array<"lesson" | "question">; index: number }) {
  if (!steps.length) return null;
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={`Step ${Math.min(index + 1, steps.length)} of ${steps.length}`}>
      {steps.map((kind, position) => {
        const done = position < index;
        const now = position === index;
        return (
          <li
            key={position}
            title={`${kind === "lesson" ? "Learn" : "Practise"}, step ${position + 1}`}
            className={cx(
              "grid h-7 w-7 place-items-center rounded-full border text-[11px] font-semibold",
              done ? "border-good bg-good text-paper" : now ? "border-accent bg-paper text-accent ring-2 ring-accent/30" : "border-ink/25 bg-paper text-ink/45",
            )}
          >
            {done ? "✓" : kind === "lesson" ? "📖" : "?"}
          </li>
        );
      })}
    </ol>
  );
}

/** Player level from total XP, with progress inside the level. */
export function LevelBar({ level, into, span, streak }: { level: number; into: number; span: number; streak: number }) {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold">
      <span className="bg-ink px-2 py-1 uppercase tracking-[0.12em] text-paper">Level {level}</span>
      <div className="h-2 w-28 bg-ink/10" role="meter" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into} aria-label="XP to next level">
        <div className="h-full bg-good transition-[width] duration-700" style={{ width: `${Math.round((into / span) * 100)}%` }} />
      </div>
      <span className="text-ink/65">
        {into}/{span} XP
      </span>
      {streak > 0 ? <span className="text-accent">🔥 {streak} day{streak === 1 ? "" : "s"}</span> : null}
    </div>
  );
}

/** Correctness as a friendly badge rather than a score. */
export function FeedbackBadge({ correctness }: { correctness: number }) {
  const [label, style] =
    correctness >= 0.8 ? ["✓ Spot on", "bg-good text-paper"] : correctness >= 0.4 ? ["◐ Almost there", "bg-[#c98a2b] text-paper"] : ["↺ Let us look again", "bg-accent text-paper"];
  return <span className={cx("inline-block px-2 py-0.5 text-xs font-semibold", style)}>{label}</span>;
}

/** One to three stars for a finished mission. */
export function Stars({ count }: { count: number }) {
  return (
    <p className="text-3xl tracking-[0.2em]" aria-label={`${count} of 3 stars`}>
      {[1, 2, 3].map((star) => (
        <span key={star} className={star <= count ? "text-[#d9a320]" : "text-ink/15"} aria-hidden="true">
          ★
        </span>
      ))}
    </p>
  );
}

/** Was this reply useful? One tap, sent once. Only the verdict is recorded, never the reply text. */
export function RateReply({ missionId, kind }: { missionId: string; kind: "feedback" | "answer" | "character" | "hint" }) {
  const [rated, setRated] = useState<boolean | null>(null);
  async function rate(useful: boolean) {
    setRated(useful);
    await authFetch("/api/tutor/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: missionId, kind, useful }),
    }).catch(() => undefined);
  }
  if (rated !== null) return <p className="mt-2 text-xs text-ink/55">{rated ? "Thanks, noted as useful." : "Thanks. That helps us improve."}</p>;
  return (
    <div className="mt-2 flex items-center gap-1.5 text-xs text-ink/60" role="group" aria-label="Was this reply useful?">
      <span>Useful?</span>
      <button type="button" onClick={() => void rate(true)} className="min-h-8 min-w-8 border border-ink/20 bg-paper px-2 hover:border-good hover:text-good" aria-label="Yes, useful">
        👍
      </button>
      <button type="button" onClick={() => void rate(false)} className="min-h-8 min-w-8 border border-ink/20 bg-paper px-2 hover:border-accent hover:text-accent" aria-label="Not useful">
        👎
      </button>
    </div>
  );
}
