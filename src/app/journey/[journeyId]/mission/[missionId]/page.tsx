"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActivityCard, Sources, type Submit } from "@/components/activity-card";
import { AppShell } from "@/components/app-shell";
import { showNotices } from "@/components/llm-notices";
import { TuningPanel } from "@/components/tuning-panel";
import { FeedbackBadge, LessonCard, LevelBar, ListenButton, RateReply, Stars, StepTrail } from "@/components/learning-visuals";
import { Button, Meter, cx } from "@/components/ui";
import { personaLabels, personas } from "@/lib/config/schema";
import { playerLevel } from "@/lib/gamification/rewards";
import type { MissionSummary, TuningState, TurnEvent } from "@/lib/tutor/engine";
import { streamTurn } from "@/lib/tutor/client";
import type { HistoryItem, Position } from "@/lib/tutor/session";
import type { ClientActivity } from "@/lib/tutor/types";
import { parseVoiceCommand, shapeOf, spokenStep } from "@/lib/voice/commands";
import { useHandsFree } from "@/lib/voice/use-hands-free";
import { useVoice } from "@/lib/voice/use-voice";

type Item =
  | (HistoryItem & { id: string })
  | { kind: "reasons"; id: string; reasons: Array<{ code: string; text: string }> }
  | { kind: "mastery"; id: string; name: string; mastery: number; delta: number }
  | { kind: "xp"; id: string; gained: number; total: number; streak: number; badges: Array<{ id: string; name: string; description: string }> }
  | { kind: "error"; id: string; text: string };

type LearnerState = TuningState;

const personaOptions = personas.map((id) => ({ id, label: personaLabels[id] }));

let counter = 0;
const nextId = () => `i${(counter += 1)}`;

function Mission() {
  const params = useParams<{ journeyId: string; missionId: string }>();
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<{ activity: ClientActivity; position: Position } | null>(null);
  const [state, setState] = useState<LearnerState | null>(null);
  const [status, setStatus] = useState<string | null>("Getting your mission ready...");
  const [busy, setBusy] = useState(true);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [summary, setSummary] = useState<MissionSummary | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [stats, setStats] = useState<{ total: number; streak: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const shownAt = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const onFinalRef = useRef<(text: string) => void>(() => undefined);
  const heardFinal = useCallback((text: string) => onFinalRef.current(text), []);
  const voice = useVoice(state?.language ?? "en", setDraft, heardFinal);
  const handsFree = useHandsFree(voice);
  const handsFreeOn = handsFree.on;
  const language = state?.language ?? "en";
  const { say, turnStarted, turnEnded } = handsFree;

  /** Reads a tutor message aloud: queued in hands-free mode, or at once when read aloud is on. */
  const speakOut = useCallback(
    (text: string) => {
      if (handsFreeOn) say(text);
      else if (readAloud) voice.speak(text);
    },
    [handsFreeOn, say, readAloud, voice],
  );

  const push = useCallback((item: Item) => setItems((list) => [...list, item]), []);

  const onEvent = useCallback(
    (event: TurnEvent) => {
      switch (event.type) {
        case "status":
          setStatus(event.text);
          break;
        case "history":
          // A reload replays the whole conversation, so nothing the learner did disappears.
          setItems(event.items.map((item) => ({ ...item, id: nextId() })));
          break;
        case "activity":
          setCurrent({ activity: event.activity, position: event.position });
          setItems((list) =>
            list.some((item) => item.kind === "activity" && item.activity.id === event.activity.id)
              ? list
              : [...list, { kind: "activity", id: nextId(), activity: event.activity, position: event.position }],
          );
          shownAt.current = Date.now();
          setStatus(null);
          if (handsFreeOn) say(spokenStep(event.activity, language));
          else if (readAloud) voice.speak(`${event.activity.title}. ${event.activity.display_text} ${event.activity.type === "lesson" ? "" : event.activity.prompt}`);
          break;
        case "feedback":
          push({ kind: "feedback", id: nextId(), text: event.text, correctness: event.correctness, sources: event.sources, follow_up: event.follow_up });
          speakOut(event.follow_up ? `${event.text} ${event.follow_up}` : event.text);
          break;
        case "character":
          push({ kind: "character", id: nextId(), text: event.text, name: event.name });
          speakOut(event.text);
          break;
        case "hint":
          push({ kind: "hint", id: nextId(), text: event.text });
          speakOut(event.text);
          break;
        case "answer":
          push({ kind: "answer", id: nextId(), text: event.text, sources: event.sources, abstained: event.abstained });
          speakOut(event.text);
          break;
        case "adaptation":
          setState(event.state);
          if (event.reasons.length) push({ kind: "reasons", id: nextId(), reasons: event.reasons });
          break;
        case "mastery":
          for (const concept of event.concepts) push({ kind: "mastery", id: nextId(), name: concept.name, mastery: concept.mastery, delta: concept.delta });
          break;
        case "xp":
          setStats({ total: event.total, streak: event.streak });
          if (event.gained > 0 || event.new_badges.length) push({ kind: "xp", id: nextId(), gained: event.gained, total: event.total, streak: event.streak, badges: event.new_badges });
          break;
        case "mission_complete":
          setSummary(event.summary);
          speakOut(language === "roman_ur" ? `Mission mukammal. Mastery ${Math.round(event.summary.mastery * 100)} percent.` : `Mission complete. Mastery ${Math.round(event.summary.mastery * 100)} percent.`);
          setCurrent(null);
          setStatus(null);
          break;
        case "notice":
          showNotices([{ kind: event.kind, text: event.text }]);
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
    [push, readAloud, voice, handsFreeOn, say, speakOut, language],
  );

  const send = useCallback(
    async (body: Omit<Parameters<typeof streamTurn>[0], "mission_id">) => {
      setBusy(true);
      turnStarted();
      try {
        await streamTurn({ mission_id: params.missionId, ...body }, onEvent);
      } finally {
        setBusy(false);
        setStatus(null);
        turnEnded();
      }
    },
    [onEvent, params.missionId, turnStarted, turnEnded],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // A review link from the home page opens a fresh practice round on a finished mission.
    const review = new URLSearchParams(window.location.search).get("review") === "1";
    if (review) window.history.replaceState(null, "", window.location.pathname);
    void send({ action: review ? "practice" : "start" });
  }, [send]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, summary]);

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

  const practice = () => {
    setSummary(null);
    setItems([]);
    setCurrent(null);
    void send({ action: "practice" });
  };

  const textOnly = state?.text_only ?? false;
  const canSpeak = !textOnly && voice.ttsSupported;
  const listen = canSpeak ? (text: string) => void voice.speak(text) : undefined;

  // Hands-free: what the learner says is matched to the step on screen and acted on.
  useEffect(() => {
    onFinalRef.current = (text: string) => {
      const words = handsFree.heard(text);
      if (words === null) return;
      const step = current?.activity;
      if (!step || summary) {
        handsFree.enable(false);
        return;
      }
      if (busy) return;
      const list = step.options ?? step.steps ?? [];
      const command = parseVoiceCommand(words, shapeOf(step), list.length);
      switch (command.action) {
        case "stop":
          handsFree.enable(false);
          break;
        case "repeat":
          handsFree.repeat();
          break;
        case "hint":
          void send({ action: "hint" });
          break;
        case "continue":
          void send({ action: "continue" });
          break;
        case "choose":
          submit({ choice_id: list[command.index].id });
          break;
        case "confidence":
          submit({ confidence: command.value, reply: "" });
          break;
        case "reply":
          submit({ reply: command.text });
          break;
        default:
          handsFree.say(
            language === "roman_ur"
              ? "Maaf kijiye, samajh nahi aaya. Aage, hint, dobara, ya apna jawab boliye."
              : "Sorry, I did not catch that. Say next, hint, repeat, or your answer.",
          );
      }
    };
  });

  const toggleHandsFree = (on: boolean) => {
    if (on) setReadAloud(false);
    const intro =
      language === "roman_ur"
        ? "Hands-free on hai. Main har qadam parh kar sunaungi, phir aapki baat sunungi. Rukne ke liye kahiye: bas."
        : "Hands-free is on. I will read each step, then listen. Say stop to end it.";
    handsFree.enable(on, on ? `${intro} ${current && !summary ? spokenStep(current.activity, language) : ""}` : undefined);
  };

  const toggleReadAloud = (on: boolean) => {
    setReadAloud(on);
    // Speaking inside the tap unlocks speech on mobile browsers for the replies that follow.
    if (on) voice.speak(state?.language === "roman_ur" ? "Read aloud on hai." : "Read aloud is on.");
    else voice.silence();
  };

  const voiceButton =
    !textOnly && voice.sttSupported ? (
      <Button type="button" variant="secondary" onClick={() => (voice.listening ? voice.stop() : voice.start())} aria-pressed={voice.listening} aria-label={voice.listening ? "Stop voice input" : "Answer with your voice"}>
        {voice.listening ? "● Listening, tap to stop" : "🎙 Speak"}
      </Button>
    ) : null;

  const languageButtons = (
    <div className="grid grid-cols-2 gap-2">
      {(["en", "roman_ur"] as const).map((language) => (
        <button
          key={language}
          type="button"
          disabled={busy}
          aria-pressed={state?.language === language}
          onClick={() => void send({ action: "set_language", language })}
          className={cx("min-h-10 border px-2 text-sm font-semibold disabled:opacity-60", state?.language === language ? "border-accent bg-accent text-paper" : "border-ink/25 bg-paper")}
        >
          {language === "en" ? "English" : "Roman Urdu"}
        </button>
      ))}
    </div>
  );

  const readAloudToggle = (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>🔊 Read replies aloud</span>
      <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={readAloud && canSpeak} disabled={!canSpeak || handsFree.on} onChange={(event) => toggleReadAloud(event.target.checked)} />
    </label>
  );

  const canHandsFree = canSpeak && voice.autoStopSupported;
  const handsFreeToggle = (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          🎧 Hands-free <span className="text-xs text-ink/55">listen, answer, repeat</span>
        </span>
        <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={handsFree.on} disabled={!canHandsFree} onChange={(event) => toggleHandsFree(event.target.checked)} />
      </label>
      {handsFree.on ? (
        <p className="text-xs leading-5 text-ink/60" role="status">
          {voice.listening ? "● Listening now." : voice.speaking ? "Reading aloud..." : "Waiting."} Say next, hint, repeat, an option letter, or your answer. Say stop to end.
        </p>
      ) : null}
      {handsFree.paused ? <p className="text-xs text-ink/60" role="status">{handsFree.paused}</p> : null}
      {!canHandsFree && canSpeak ? <p className="text-xs text-ink/55">Hands-free needs Chrome or Edge speech recognition. Everything else works here.</p> : null}
    </div>
  );

  const settingsBody = (
    <>
      <div className="space-y-3">
        <TuningPanel state={state} focus={summary ? null : current?.activity.concept_name.split(" + ").join(", ")} />
        {current && !summary && current.activity.type !== "lesson" ? (
          <Button variant="secondary" className="w-full" disabled={busy} onClick={() => void send({ action: "hint" })}>
            I would like a hint
          </Button>
        ) : null}
      </div>

      <fieldset className="border border-ink/15 bg-panel p-4" disabled={busy}>
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Language</legend>
        <div className="mt-2">{languageButtons}</div>
      </fieldset>

      <fieldset className="border border-ink/15 bg-panel p-4" disabled={busy}>
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Learner type</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {personaOptions.map((persona) => (
            <button
              key={persona.id}
              type="button"
              aria-pressed={state?.persona === persona.id}
              onClick={() => void send({ action: "set_persona", persona: persona.id })}
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
        {readAloudToggle}
        {handsFreeToggle}
        {!voice.ttsSupported ? <p className="text-xs text-ink/55">This browser cannot read aloud. Text works fully.</p> : null}
        {(readAloud || handsFree.on) && voice.engine === "device" && voice.hasVoices && !voice.southAsianVoice ? (
          <p className="text-xs text-ink/55">This device has no Pakistani or South Asian English voice, so a standard English voice reads aloud. In Microsoft Edge, the English (India) voices sound closest.</p>
        ) : null}
      </fieldset>
    </>
  );

  const level = stats ? playerLevel(stats.total) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section aria-label="Mission conversation" className="min-w-0 space-y-4" data-tour="mission">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/journey/${params.journeyId}`} className="text-sm font-semibold text-ink/60 hover:text-accent">
            ← Journey map
          </Link>
          {level && stats ? <LevelBar level={level.level} into={level.into} span={level.span} streak={stats.streak} /> : null}
        </div>
        {current?.position.steps && !summary ? <StepTrail steps={current.position.steps} index={current.position.index} /> : null}

        <div aria-live="polite" className="space-y-4">
          {items.map((item) => {
            switch (item.kind) {
              case "activity": {
                const active = item.activity.id === current?.activity.id && !summary;
                if (item.activity.type === "lesson") {
                  return <LessonCard key={item.id} activity={item.activity} active={active} busy={busy} onContinue={() => void send({ action: "continue" })} onListen={listen} />;
                }
                return active ? (
                  <ActivityCard
                    key={item.id}
                    activity={item.activity}
                    position={item.position}
                    busy={busy}
                    onSubmit={submit}
                    draft={draft}
                    setDraft={setDraft}
                    voiceSlot={voiceButton}
                    onListen={listen}
                  />
                ) : (
                  <div key={item.id} className="border border-ink/10 bg-panel/60 p-4 text-sm text-ink/70">
                    <strong className="text-ink">❓ {item.activity.title}.</strong> {item.activity.prompt}
                  </div>
                );
              }
              case "learner":
                return (
                  <p key={item.id} className="ml-auto max-w-[85%] bg-ink px-4 py-3 text-sm text-paper">
                    {item.text}
                  </p>
                );
              case "feedback":
                return (
                  <div key={item.id} className={cx("max-w-[92%] border-l-4 bg-paper px-4 py-3", item.correctness >= 0.8 ? "border-good" : item.correctness >= 0.4 ? "border-[#c98a2b]" : "border-accent")}>
                    <div className="flex items-center justify-between gap-2">
                      <FeedbackBadge correctness={item.correctness} />
                      <ListenButton text={item.follow_up ? `${item.text} ${item.follow_up}` : item.text} onListen={listen} />
                    </div>
                    <p className="mt-2 leading-7">{item.text}</p>
                    {item.follow_up ? <p className="mt-2 font-semibold">{item.follow_up}</p> : null}
                    <Sources sources={item.sources} />
                    <RateReply missionId={params.missionId} kind="feedback" />
                  </div>
                );
              case "character":
                return (
                  <div key={item.id} className="max-w-[88%] border border-accent/30 bg-paper px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">🗣 {item.name}</p>
                      <ListenButton text={item.text} onListen={listen} />
                    </div>
                    <p className="mt-1 leading-7">{item.text}</p>
                    <RateReply missionId={params.missionId} kind="character" />
                  </div>
                );
              case "hint":
                return (
                  <p key={item.id} className="sticky-note sticky-note-1 max-w-[92%] px-4 py-3 text-sm">
                    <strong>💡 Hint:</strong> {item.text}
                  </p>
                );
              case "answer":
                return (
                  <div key={item.id} className="max-w-[92%] border-l-4 border-ink/40 bg-paper px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      {item.abstained ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/55">Not in your material</p> : <span />}
                      <ListenButton text={item.text} onListen={listen} />
                    </div>
                    <p className="mt-1 leading-7">{item.text}</p>
                    <Sources sources={item.sources} />
                    <RateReply missionId={params.missionId} kind="answer" />
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
                      <p className="inline-block bg-good px-3 py-1 font-semibold text-paper">
                        +{item.gained} XP{item.streak > 0 ? ` / 🔥 ${item.streak} day streak` : ""}
                      </p>
                    ) : null}
                    {item.badges.map((badge) => (
                      <p key={badge.id} className="mt-2 block w-fit border-2 border-good bg-paper px-3 py-2">
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-3xl font-semibold tracking-[-0.03em]">{summary.title}</h2>
              <Stars count={summary.stars ?? 1} />
            </div>
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
              <Button variant="secondary" disabled={busy} onClick={practice}>
                {summary.unlocked_next ? "Practise again" : "Practice round"}
              </Button>
            </div>
          </section>
        )}

        {!summary && current && current.activity.type !== "lesson" && (
          <form
            data-tour="ask"
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

      <aside className="hidden space-y-5 lg:sticky lg:top-24 lg:block lg:self-start" aria-label="Learning settings">
        {settingsBody}
      </aside>

      {/* Phones: the mission comes first. One bar at the bottom holds the quick actions and opens the settings as a sheet. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/15 bg-paper/95 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 py-2 pl-4 pr-20">
          {current && !summary && current.activity.type !== "lesson" ? (
            <Button variant="secondary" className="px-3" disabled={busy} onClick={() => void send({ action: "hint" })}>
              💡 Hint
            </Button>
          ) : null}
          {canHandsFree ? (
            <Button variant={handsFree.on ? "primary" : "secondary"} className="px-3" aria-pressed={handsFree.on} onClick={() => toggleHandsFree(!handsFree.on)}>
              🎧 {handsFree.on ? (voice.listening ? "Listening" : "On") : "Hands-free"}
            </Button>
          ) : null}
          <Button variant="secondary" className="ml-auto px-3" data-tour="tuning" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>
            ⚙ Tuning{state ? ` · L${state.difficulty}` : ""}
          </Button>
        </div>
      </div>
      {sheetOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Tuning and settings" className="fixed inset-0 z-50 lg:hidden" onKeyDown={(event) => event.key === "Escape" && setSheetOpen(false)}>
          <button type="button" aria-label="Close settings" className="absolute inset-0 h-full w-full bg-ink/40" onClick={() => setSheetOpen(false)} />
          <div className="animate-rise absolute inset-x-0 bottom-0 max-h-[85vh] space-y-4 overflow-y-auto border-t border-ink/20 bg-paper p-4 pb-8">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Tuning and settings</p>
              <button type="button" autoFocus onClick={() => setSheetOpen(false)} className="min-h-11 px-3 text-sm font-semibold text-accent">
                Done
              </button>
            </div>
            {settingsBody}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function MissionPage() {
  return <AppShell wide>{() => <Mission />}</AppShell>;
}
