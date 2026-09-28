"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActivityCard, Sources, type Submit } from "@/components/activity-card";
import { AppShell } from "@/components/app-shell";
import { Button, Meter, cx } from "@/components/ui";
import type { MissionSummary, TurnEvent } from "@/lib/tutor/engine";
import { streamTurn } from "@/lib/tutor/client";
import type { ClientActivity } from "@/lib/tutor/types";
import { useVoice } from "@/lib/voice/use-voice";

type Item =
  | { kind: "activity"; id: string; activity: ClientActivity; position: { index: number; total: number } }
  | { kind: "learner"; id: string; text: string }
  | { kind: "feedback"; id: string; text: string; correctness: number; sources: ClientActivity["sources"]; follow_up?: string }
  | { kind: "character"; id: string; text: string; name: string }
  | { kind: "hint"; id: string; text: string }
  | { kind: "answer"; id: string; text: string; sources: ClientActivity["sources"]; abstained: boolean }
  | { kind: "reasons"; id: string; reasons: Array<{ code: string; text: string }> }
  | { kind: "mastery"; id: string; name: string; mastery: number; delta: number }
  | { kind: "xp"; id: string; gained: number; total: number; streak: number; badges: Array<{ id: string; name: string; description: string }> }
  | { kind: "error"; id: string; text: string };

type LearnerState = { difficulty: number; pace: string; modality: string; language: "en" | "roman_ur"; persona: string; text_only: boolean };

const personaOptions = [
  { id: "new_joiner", label: "New joiner" },
  { id: "busy_rm", label: "Busy RM" },
  { id: "expert", label: "Expert" },
  { id: "low_bandwidth", label: "Low bandwidth" },
];

let counter = 0;
const nextId = () => `i${(counter += 1)}`;

function Mission() {
  const params = useParams<{ journeyId: string; missionId: string }>();
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<{ activity: ClientActivity; position: { index: number; total: number } } | null>(null);
  const [state, setState] = useState<LearnerState | null>(null);
  const [status, setStatus] = useState<string | null>("Getting your mission ready...");
  const [busy, setBusy] = useState(true);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [summary, setSummary] = useState<MissionSummary | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [contrast, setContrast] = useState(false);
  const shownAt = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const voice = useVoice(state?.language ?? "en", setDraft);

  const push = useCallback((item: Item) => setItems((list) => [...list, item]), []);

  const onEvent = useCallback(
    (event: TurnEvent) => {
      switch (event.type) {
        case "status":
          setStatus(event.text);
          break;
        case "activity":
          setCurrent({ activity: event.activity, position: event.position });
          push({ kind: "activity", id: nextId(), activity: event.activity, position: event.position });
          shownAt.current = Date.now();
          setStatus(null);
          if (readAloud) voice.speak(`${event.activity.display_text} ${event.activity.prompt}`);
          break;
        case "feedback":
          push({ kind: "feedback", id: nextId(), text: event.text, correctness: event.correctness, sources: event.sources, follow_up: event.follow_up });
          if (readAloud) voice.speak(event.follow_up ? `${event.text} ${event.follow_up}` : event.text);
          break;
        case "character":
          push({ kind: "character", id: nextId(), text: event.text, name: event.name });
          if (readAloud) voice.speak(event.text);
          break;
        case "hint":
          push({ kind: "hint", id: nextId(), text: event.text });
          break;
        case "answer":
          push({ kind: "answer", id: nextId(), text: event.text, sources: event.sources, abstained: event.abstained });
          if (readAloud) voice.speak(event.text);
          break;
        case "adaptation":
          setState(event.state);
          if (event.reasons.length) push({ kind: "reasons", id: nextId(), reasons: event.reasons });
          break;
        case "mastery":
          for (const concept of event.concepts) push({ kind: "mastery", id: nextId(), name: concept.name, mastery: concept.mastery, delta: concept.delta });
          break;
        case "xp":
          if (event.gained > 0 || event.new_badges.length) push({ kind: "xp", id: nextId(), gained: event.gained, total: event.total, streak: event.streak, badges: event.new_badges });
          break;
        case "mission_complete":
          setSummary(event.summary);
          setCurrent(null);
          setStatus(null);
          break;
        case "error":
          push({ kind: "error", id: nextId(), text: event.message });
          setStatus(null);
          break;
        case "done":
          setStatus(null);
          break;
      }
    },
    [push, readAloud, voice],
  );

  const send = useCallback(
    async (body: Omit<Parameters<typeof streamTurn>[0], "mission_id">) => {
      setBusy(true);
      try {
        await streamTurn({ mission_id: params.missionId, ...body }, onEvent);
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [onEvent, params.missionId],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send({ action: "start" });
  }, [send]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, summary]);

  useEffect(() => {
    document.documentElement.dataset.contrast = contrast ? "high" : "";
  }, [contrast]);

  const submit: Submit = (answer) => {
    const label =
      answer.reply ??
      (answer.choice_id
        ? (current?.activity.options?.find((option) => option.id === answer.choice_id)?.text ?? current?.activity.steps?.find((step) => step.id === answer.choice_id)?.text)
        : answer.order
          ? answer.order.map((id, index) => `${index + 1}. ${current?.activity.items?.find((item) => item.id === id)?.text}`).join(" ")
          : undefined);
    push({ kind: "learner", id: nextId(), text: [answer.confidence ? `Confidence ${answer.confidence}/5.` : "", label ?? ""].filter(Boolean).join(" ") });
    setDraft("");
    voice.setTranscript("");
    void send({ action: "answer", ...answer, response_ms: Date.now() - shownAt.current });
  };

  const ask = () => {
    const text = question.trim();
    if (!text) return;
    push({ kind: "learner", id: nextId(), text });
    setQuestion("");
    void send({ action: "ask", question: text });
  };

  const textOnly = state?.text_only ?? false;
  const voiceButton =
    !textOnly && voice.sttSupported ? (
      <Button type="button" variant="secondary" onClick={voice.listening ? voice.stop : voice.start} aria-pressed={voice.listening} aria-label={voice.listening ? "Stop voice input" : "Answer with your voice"}>
        {voice.listening ? "● Listening, tap to stop" : "🎙 Speak"}
      </Button>
    ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section aria-label="Mission conversation" className="min-w-0 space-y-4">
        <Link href={`/journey/${params.journeyId}`} className="text-sm font-semibold text-ink/60 hover:text-accent">
          ← Journey map
        </Link>
        <div aria-live="polite" className="space-y-4">
          {items.map((item) => {
            switch (item.kind) {
              case "activity":
                return item.activity.id === current?.activity.id && !summary ? (
                  <ActivityCard
                    key={item.id}
                    activity={item.activity}
                    position={item.position}
                    busy={busy}
                    onSubmit={submit}
                    draft={draft}
                    setDraft={setDraft}
                    voiceSlot={voiceButton}
                  />
                ) : (
                  <div key={item.id} className="border border-ink/10 bg-panel/60 p-4 text-sm text-ink/70">
                    <strong className="text-ink">{item.activity.title}.</strong> {item.activity.prompt}
                  </div>
                );
              case "learner":
                return (
                  <p key={item.id} className="ml-auto max-w-[85%] bg-ink px-4 py-3 text-sm text-paper">
                    {item.text}
                  </p>
                );
              case "feedback":
                return (
                  <div key={item.id} className={cx("max-w-[92%] border-l-4 bg-paper px-4 py-3", item.correctness >= 0.8 ? "border-good" : item.correctness >= 0.4 ? "border-accent/60" : "border-accent")}>
                    <p className="leading-7">{item.text}</p>
                    {item.follow_up ? <p className="mt-2 font-semibold">{item.follow_up}</p> : null}
                    <Sources sources={item.sources} />
                  </div>
                );
              case "character":
                return (
                  <div key={item.id} className="max-w-[88%] border border-accent/30 bg-paper px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{item.name}</p>
                    <p className="mt-1 leading-7">{item.text}</p>
                  </div>
                );
              case "hint":
                return (
                  <p key={item.id} className="max-w-[92%] border border-dashed border-ink/30 px-4 py-3 text-sm">
                    <strong>Hint:</strong> {item.text}
                  </p>
                );
              case "answer":
                return (
                  <div key={item.id} className="max-w-[92%] border-l-4 border-ink/40 bg-paper px-4 py-3">
                    {item.abstained ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/55">Not in your material</p> : null}
                    <p className="leading-7">{item.text}</p>
                    <Sources sources={item.sources} />
                  </div>
                );
              case "reasons":
                return (
                  <div key={item.id} className="flex flex-wrap gap-2" role="note" aria-label="Why this changed">
                    {item.reasons.map((reason) => (
                      <span key={reason.code + reason.text} className="inline-flex items-start gap-2 rounded-full border border-accent/40 bg-paper px-3 py-1.5 text-xs">
                        <strong className="shrink-0 text-accent">Why this changed:</strong> <span>{reason.text}</span>
                      </span>
                    ))}
                  </div>
                );
              case "mastery":
                return (
                  <div key={item.id} className="max-w-sm space-y-1 text-xs">
                    <p>
                      <strong>{item.name}</strong>: {Math.round(item.mastery * 100)}% {item.delta >= 0 ? `(+${Math.round(item.delta * 100)})` : `(${Math.round(item.delta * 100)})`}
                    </p>
                    <Meter value={item.mastery} label={`${item.name} mastery`} />
                  </div>
                );
              case "xp":
                return (
                  <div key={item.id} className="animate-rise text-sm">
                    {item.gained > 0 ? (
                      <p className="font-semibold text-good">
                        +{item.gained} XP / {item.total} total / {item.streak} day streak
                      </p>
                    ) : null}
                    {item.badges.map((badge) => (
                      <p key={badge.id} className="mt-2 inline-block border border-good bg-paper px-3 py-2">
                        🏅 Badge unlocked: <strong>{badge.name}</strong>. {badge.description}
                      </p>
                    ))}
                  </div>
                );
              case "error":
                return (
                  <p key={item.id} role="alert" className="border border-danger/40 bg-danger-soft px-4 py-3 text-sm">
                    {item.text}
                  </p>
                );
            }
          })}
          {status ? (
            <p className="flex items-center gap-2 text-sm text-ink/60" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> {status}
            </p>
          ) : null}
          {voice.note ? <p className="text-sm text-ink/60" role="status">{voice.note}</p> : null}
        </div>

        {summary && (
          <section className="animate-rise border-2 border-good bg-paper p-6" aria-label="Mission complete">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-good">Mission complete</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">{summary.title}</h2>
            <p className="mt-3 text-ink/75">
              Mission mastery {Math.round(summary.mastery * 100)}% / {summary.xp_earned} XP earned.
            </p>
            <ul className="mt-4 space-y-3">
              {summary.concepts.map((concept) => (
                <li key={concept.id} className="text-sm">
                  <span className="font-semibold">{concept.name}</span> {Math.round(concept.mastery * 100)}%
                  <Meter value={concept.mastery} label={`${concept.name} mastery`} />
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm">
              {summary.unlocked_next
                ? "You showed enough mastery to unlock the next mission."
                : `The next mission unlocks at ${Math.round(summary.threshold * 100)}% mastery. A short practice round will get you there.`}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/journey/${params.journeyId}`} className="inline-flex min-h-11 items-center bg-ink px-5 text-sm font-semibold text-paper hover:bg-accent">
                Back to the journey map
              </Link>
              {!summary.unlocked_next ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSummary(null);
                    setItems([]);
                    void send({ action: "start" });
                  }}
                >
                  Practice round
                </Button>
              ) : null}
            </div>
          </section>
        )}

        {!summary && current && (
          <form
            className="flex gap-2 border-t border-ink/15 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <label htmlFor="ask" className="sr-only">
              Ask a question about your material
            </label>
            <input
              id="ask"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={600}
              placeholder="Ask anything about your material..."
              className="min-w-0 flex-1 border border-ink/25 bg-paper px-4 py-3 outline-none focus:border-accent"
            />
            <Button type="submit" variant="secondary" disabled={busy || !question.trim()}>
              Ask
            </Button>
          </form>
        )}
        <div ref={bottom} />
      </section>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start" aria-label="Learning settings">
        <div className="border border-ink/15 bg-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Right now</p>
          {state ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink/60">Level</dt>
              <dd className="font-semibold">{state.difficulty} / 5</dd>
              <dt className="text-ink/60">Pace</dt>
              <dd className="font-semibold capitalize">{state.pace}</dd>
              <dt className="text-ink/60">Style</dt>
              <dd className="font-semibold">{state.modality === "choices" ? "Guided choices" : "Open questions"}</dd>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink/60">Loading...</p>
          )}
          {current && !summary ? (
            <Button variant="secondary" className="mt-4 w-full" disabled={busy} onClick={() => void send({ action: "hint" })}>
              I would like a hint
            </Button>
          ) : null}
        </div>

        <fieldset className="border border-ink/15 bg-panel p-4" disabled={busy}>
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Language</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["en", "roman_ur"] as const).map((language) => (
              <button
                key={language}
                type="button"
                aria-pressed={state?.language === language}
                onClick={() => void send({ action: "set_language", language })}
                className={cx("min-h-11 border text-sm font-semibold", state?.language === language ? "border-accent bg-accent text-paper" : "border-ink/25 bg-paper")}
              >
                {language === "en" ? "English" : "Roman Urdu"}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="border border-ink/15 bg-panel p-4" disabled={busy}>
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Learner type</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {personaOptions.map((persona) => (
              <button
                key={persona.id}
                type="button"
                aria-pressed={state?.persona === persona.id}
                onClick={() => void send({ action: "set_persona", persona: persona.id as "new_joiner" })}
                className={cx("min-h-11 border px-2 text-xs font-semibold", state?.persona === persona.id ? "border-accent bg-accent text-paper" : "border-ink/25 bg-paper")}
              >
                {persona.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3 border border-ink/15 bg-panel p-4 text-sm">
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Access</legend>
          <label className="flex items-center justify-between gap-3">
            Text only mode
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={textOnly} disabled={busy} onChange={(event) => void send({ action: "set_text_only", text_only: event.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            Read replies aloud
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--accent)]"
              checked={readAloud && !textOnly}
              disabled={textOnly || !voice.ttsSupported}
              onChange={(event) => {
                setReadAloud(event.target.checked);
                if (!event.target.checked) voice.silence();
              }}
            />
          </label>
          {!voice.ttsSupported ? <p className="text-xs text-ink/55">This browser cannot read aloud. Text works fully.</p> : null}
          {readAloud && state?.language === "roman_ur" && voice.hasVoices ? <p className="text-xs text-ink/55">Roman Urdu is read by an English voice, captions stay on.</p> : null}
          <label className="flex items-center justify-between gap-3">
            High contrast
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={contrast} onChange={(event) => setContrast(event.target.checked)} />
          </label>
        </fieldset>
      </aside>
    </div>
  );
}

export default function MissionPage() {
  return <AppShell wide>{() => <Mission />}</AppShell>;
}
