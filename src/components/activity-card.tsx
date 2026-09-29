"use client";

import { useState } from "react";

import { ListenButton } from "@/components/learning-visuals";
import { Button, cx } from "@/components/ui";
import type { ClientActivity } from "@/lib/tutor/types";

export type Submit = (answer: { reply?: string; choice_id?: string; order?: string[]; confidence?: number }) => void;

const typeLabels: Record<string, string> = {
  explain_ask: "Explore",
  scenario: "Decision",
  spot_error: "Spot the slip",
  ordering: "Put in order",
  roleplay: "Role-play",
  teach_back: "Teach a friend",
  spaced_recall: "Quick flashback",
  reflection: "Check in",
  capstone: "Capstone case",
  crossroads: "Crossroads",
};

const groundingLabels: Record<ClientActivity["grounded"], string> = {
  verified: "Checked against your source",
  unverified: "From your source",
  abstained: "Quoted straight from your source",
};

export function Sources({ sources }: { sources: ClientActivity["sources"] }) {
  if (!sources.length) return null;
  return (
    <details className="mt-3 text-xs text-ink/60">
      <summary className="cursor-pointer select-none font-semibold text-ink/70">
        Sources: {sources.map((source) => source.label).join(", ")}
      </summary>
      <ul className="mt-2 space-y-2">
        {sources.map((source) => (
          <li key={source.id} className="border-l-2 border-accent/40 pl-3 leading-5">
            <strong className="text-ink/80">{source.label}.</strong> {source.excerpt}
            {source.excerpt.length >= 280 ? "..." : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ActivityCard({
  activity,
  position,
  busy,
  onSubmit,
  draft,
  setDraft,
  voiceSlot,
  onListen,
}: {
  activity: ClientActivity;
  position: { index: number; total: number };
  busy: boolean;
  onSubmit: Submit;
  draft: string;
  setDraft: (value: string) => void;
  voiceSlot?: React.ReactNode;
  onListen?: (text: string) => void;
}) {
  const [order, setOrder] = useState(() => (activity.items ?? []).map((item) => item.id));
  const [confidence, setConfidence] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const move = (index: number, delta: number) => {
    setOrder((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const openAnswer = ["explain_ask", "teach_back", "spaced_recall", "roleplay", "capstone"].includes(activity.type);

  return (
    <article className="animate-rise border border-ink/20 bg-panel p-5 sm:p-6" aria-labelledby={`activity-${activity.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
        <span className="text-accent">
          ❓ {typeLabels[activity.type] ?? activity.type} / step {position.index + 1} of {position.total}
        </span>
        <span className="text-ink/55">
          Challenge {activity.difficulty}/5 / {groundingLabels[activity.grounded]}
        </span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <h2 id={`activity-${activity.id}`} className="text-2xl font-semibold tracking-[-0.02em]">
          {activity.title}
        </h2>
        <ListenButton
          className="shrink-0"
          onListen={onListen}
          text={[activity.display_text, activity.prompt, ...(activity.options ?? []).map((option, index) => `${String.fromCharCode(65 + index)}. ${option.text}`)].join(" ")}
        />
      </div>
      <p className="mt-3 whitespace-pre-line text-base leading-7">{activity.display_text}</p>
      {activity.roleplay ? (
        <p className="mt-3 border-l-2 border-accent pl-3 text-sm text-ink/70">
          <strong>{activity.roleplay.character}</strong>: {activity.roleplay.situation}
        </p>
      ) : null}
      {activity.type === "crossroads" ? (
        <p className="mt-3 inline-flex items-center gap-2 border border-accent/40 bg-paper px-3 py-1.5 text-xs font-semibold text-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M6 3v6a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4M18 3v4M6 21v-8" /></svg> Your path shapes what happens next. There is no going back at a crossroads.
        </p>
      ) : null}
      {activity.type === "capstone" ? (
        <p className="mt-3 border border-ink/20 bg-paper px-3 py-2 text-xs leading-5">
          <strong className="text-accent">Brings together:</strong> {activity.concept_name.split(" + ").join(", ")}. Use all of them in your answer.
        </p>
      ) : null}
      <p className="mt-4 font-semibold">{activity.prompt}</p>

      {(activity.type === "scenario" || activity.type === "crossroads") && activity.options && (
        <div className="mt-4 grid gap-2" role="group" aria-label={activity.type === "crossroads" ? "Choose a path" : "Choose an option"}>
          {activity.options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              onClick={() => {
                setPicked(option.id);
                onSubmit({ choice_id: option.id });
              }}
              className={cx(
                "min-h-11 border px-4 py-3 text-left text-sm transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60",
                picked === option.id ? "border-accent bg-paper" : "border-ink/20 bg-paper",
              )}
            >
              <span className="mr-2 font-semibold text-accent">{String.fromCharCode(65 + index)}.</span>
              {option.text}
            </button>
          ))}
        </div>
      )}

      {activity.type === "spot_error" && activity.steps && (
        <ol className="mt-4 grid gap-2" aria-label="Steps. Choose the one that went wrong">
          {activity.steps.map((step, index) => (
            <li key={step.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPicked(step.id);
                  onSubmit({ choice_id: step.id });
                }}
                className={cx(
                  "flex min-h-11 w-full gap-3 border px-4 py-3 text-left text-sm transition hover:border-accent disabled:opacity-60",
                  picked === step.id ? "border-accent bg-paper" : "border-ink/20 bg-paper",
                )}
              >
                <span className="font-semibold text-accent">Step {index + 1}</span>
                <span>{step.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {activity.type === "ordering" && activity.items && (
        <div className="mt-4">
          <ol className="grid gap-2" aria-label="Steps to order">
            {order.map((id, index) => {
              const item = activity.items?.find((entry) => entry.id === id);
              return (
                <li key={id} className="flex items-center gap-2 border border-ink/20 bg-paper px-3 py-2 text-sm">
                  <span className="w-6 font-semibold text-accent">{index + 1}.</span>
                  <span className="flex-1">{item?.text}</span>
                  <button type="button" aria-label={`Move "${item?.text}" up`} onClick={() => move(index, -1)} disabled={index === 0 || busy} className="min-h-9 min-w-9 border border-ink/20 disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" aria-label={`Move "${item?.text}" down`} onClick={() => move(index, 1)} disabled={index === order.length - 1 || busy} className="min-h-9 min-w-9 border border-ink/20 disabled:opacity-30">
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
          <Button className="mt-3" disabled={busy} onClick={() => onSubmit({ order })}>
            Check my order
          </Button>
        </div>
      )}

      {activity.type === "reflection" && (
        <div className="mt-4 space-y-3">
          <div role="radiogroup" aria-label="How confident are you, 1 to 5" className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={confidence === value}
                onClick={() => setConfidence(value)}
                className={cx("min-h-11 min-w-11 border px-3 font-semibold", confidence === value ? "border-accent bg-accent text-paper" : "border-ink/25 bg-paper")}
              >
                {value}
              </button>
            ))}
            <span className="self-center text-xs text-ink/55">1 unsure, 5 very sure</span>
          </div>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={2_000}
            aria-label="One thing you would do differently (optional)"
            placeholder="One thing you would do differently next time (optional)"
            className="w-full border border-ink/25 bg-paper px-4 py-3 outline-none focus:border-accent"
          />
          <Button disabled={busy || confidence === null} onClick={() => onSubmit({ confidence: confidence ?? 3, reply: draft })}>
            Share
          </Button>
        </div>
      )}

      {openAnswer && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onSubmit({ reply: draft.trim() });
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={activity.type === "roleplay" ? 2 : 3}
            maxLength={2_000}
            aria-label="Your reply"
            placeholder={activity.type === "roleplay" ? `Reply to ${activity.roleplay?.character ?? "the character"}...` : "Type or speak your answer, in English or Roman Urdu..."}
            className="w-full border border-ink/25 bg-paper px-4 py-3 text-base outline-none focus:border-accent"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && draft.trim()) onSubmit({ reply: draft.trim() });
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !draft.trim()}>
              {activity.type === "roleplay" ? "Send" : "Share my answer"}
            </Button>
            {voiceSlot}
          </div>
        </form>
      )}
      <Sources sources={activity.sources} />
    </article>
  );
}
