"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Alert, Eyebrow, Meter, cx } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import type { MissionView } from "@/lib/journey/load";
import { storyboardSeenKey } from "@/lib/storyboard/story";
import { routeInfo, type LearningRoute } from "@/lib/config/schema";

type JourneyData = {
  journey: { id: string; title: string | null; story_theme: string; planner?: string; route?: LearningRoute; language: string; persona: string | null };
  missions: MissionView[];
  learner: { persona: string; language: string; xp: number; streak: number; best_streak: number; badges: Array<{ id: string; name: string; description: string }> };
  thresholds: { unlock: number; mastered: number };
  storyboard?: { enabled: boolean; ready: boolean; panels: number };
};

const typeIcons: Record<string, string> = {
  explain_ask: "Explore",
  scenario: "Decision",
  spot_error: "Spot the slip",
  ordering: "Order",
  roleplay: "Role-play",
  teach_back: "Teach back",
  spaced_recall: "Flashback",
  reflection: "Check in",
  capstone: "Capstone case",
  crossroads: "Crossroads",
};

const statusText: Record<MissionView["status"], string> = {
  locked: "Locked",
  available: "Ready",
  in_progress: "In progress",
  completed: "Completed",
  practice: "Practice",
};

function heat(value: number) {
  if (value >= 0.8) return "bg-good text-paper";
  if (value >= 0.6) return "bg-good/70 text-paper";
  if (value >= 0.3) return "bg-good/35";
  if (value > 0) return "bg-good/15";
  return "bg-ink/5";
}

function JourneyMap() {
  const params = useParams<{ journeyId: string }>();
  const [data, setData] = useState<JourneyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    try {
      // Browser storage is read after mount, so the server and first client render agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(window.localStorage.getItem(storyboardSeenKey(params.journeyId)) === "1");
    } catch {
      setSeen(false);
    }
  }, [params.journeyId]);

  useEffect(() => {
    authFetch(`/api/journeys/${params.journeyId}`)
      .then(async (response) => {
        const payload = (await response.json()) as JourneyData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load the journey");
        setData(payload);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load the journey"));
  }, [params.journeyId]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-ink/60">Loading your journey...</p>;

  const concepts = data.missions.flatMap((mission) => mission.concepts);
  const done = data.missions.filter((mission) => mission.status === "completed").length;

  return (
    <div className="space-y-10">
      <header className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <Eyebrow>
            Your journey{data.journey.route ? ` / ${routeInfo[data.journey.route]?.label ?? "Narrative"} route` : ""}
          </Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold leading-[0.95] tracking-[-0.035em] sm:text-5xl">{data.journey.title}</h1>
          <p className="mt-4 max-w-2xl text-lg leading-7 text-ink/70">{data.journey.story_theme}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 border border-ink/15 bg-panel p-4 text-center">
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-ink/55">XP</dt>
            <dd className="text-2xl font-semibold">{data.learner.xp}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-ink/55">Streak</dt>
            <dd className="text-2xl font-semibold">{data.learner.streak}d</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-ink/55">Missions</dt>
            <dd className="text-2xl font-semibold">
              {done}/{data.missions.length}
            </dd>
          </div>
        </dl>
      </header>

      {data.storyboard?.enabled ? (
        <section
          aria-label="Storyboard"
          data-tour="storyboard"
          className={cx("flex flex-col gap-4 border p-5 sm:flex-row sm:items-center sm:justify-between", seen ? "border-ink/15 bg-panel" : "border-accent bg-paper")}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">{seen ? "Storyboard" : "Start here"}</p>
            <h2 className="mt-1 text-xl font-semibold">{seen ? "Watch the storyboard again" : "See the whole journey first"}</h2>
            <p className="mt-1 text-sm text-ink/65">
              {data.storyboard.panels} illustrated panels, about {Math.max(1, Math.round((data.storyboard.panels * 10) / 60))} minute
              {Math.round((data.storyboard.panels * 10) / 60) > 1 ? "s" : ""}. Every quote comes from your material.
            </p>
          </div>
          <Link
            href={`/journey/${data.journey.id}/storyboard`}
            className={cx("inline-flex min-h-11 shrink-0 items-center justify-center px-5 text-sm font-semibold", seen ? "border border-ink/25 bg-paper hover:border-accent hover:text-accent" : "bg-accent text-paper hover:bg-ink")}
          >
            ▶ {seen ? "Replay" : "Play the storyboard"}
          </Link>
        </section>
      ) : null}

      <section aria-label="Missions" data-tour="missions">
        <ol className="relative space-y-4 border-l-2 border-ink/15 pl-6">
          {data.missions.map((mission) => {
            const locked = mission.status === "locked";
            const body = (
              <div
                className={cx(
                  "border p-5 transition",
                  locked ? "border-ink/10 bg-ink/[0.03] text-ink/50" : "border-ink/20 bg-panel hover:border-accent",
                  mission.status === "in_progress" && "border-accent",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
                  <span className={locked ? "" : "text-accent"}>
                    Mission {mission.idx + 1} / {statusText[mission.status]}
                  </span>
                  <span>{Math.round(mission.mastery * 100)}% mastery</span>
                </div>
                <h2 className="mt-2 text-xl font-semibold">
                  {locked ? "🔒 " : mission.status === "completed" ? "✓ " : ""}
                  {mission.title}
                </h2>
                <p className="mt-2 text-sm leading-6">{mission.story}</p>
                <p className="mt-3 flex flex-wrap gap-2 text-xs">
                  {mission.activity_types.map((type) => (
                    <span key={type} className="border border-ink/15 px-2 py-1">
                      {typeIcons[type] ?? type}
                    </span>
                  ))}
                </p>
                {mission.progress > 0 && mission.progress < 1 ? (
                  <div className="mt-3">
                    <Meter value={mission.progress} label="Mission progress" />
                  </div>
                ) : null}
                {mission.lock_reason ? <p className="mt-3 text-sm font-medium">{mission.lock_reason}</p> : null}
              </div>
            );
            return (
              <li key={mission.id} className="relative">
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute -left-[33px] top-6 h-4 w-4 rounded-full border-2",
                    mission.status === "completed" ? "border-good bg-good" : locked ? "border-ink/25 bg-paper" : "border-accent bg-paper",
                  )}
                />
                {locked ? (
                  <div aria-disabled="true">{body}</div>
                ) : (
                  <Link href={`/journey/${data.journey.id}/mission/${mission.id}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="Mastery heatmap" className="space-y-3" data-tour="mastery">
        <h2 className="text-xl font-semibold">What you have shown so far</h2>
        <p className="text-sm text-ink/60">
          Estimated from how you answer, choose, fix mistakes and recall. No tests. Unlock at {Math.round(data.thresholds.unlock * 100)}%, mastered at{" "}
          {Math.round(data.thresholds.mastered * 100)}%.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {concepts.map((concept) => (
            <li key={concept.id} className={cx("flex items-center justify-between gap-3 px-3 py-2 text-sm", heat(concept.mastery))}>
              <span className="font-medium">{concept.name}</span>
              <span className="text-xs font-semibold">
                {Math.round(concept.mastery * 100)}% {concept.label}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Badges" className="space-y-3">
        <h2 className="text-xl font-semibold">Badges</h2>
        {data.learner.badges.length ? (
          <ul className="flex flex-wrap gap-2">
            {data.learner.badges.map((badge) => (
              <li key={badge.id} className="border border-good bg-paper px-3 py-2 text-sm" title={badge.description}>
                🏅 <strong>{badge.name}</strong> <span className="text-ink/60">{badge.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">Badges come from what you do: spotting slips, fixing your own answers, teaching back.</p>
        )}
      </section>
    </div>
  );
}

export default function JourneyPage() {
  return <AppShell>{() => <JourneyMap />}</AppShell>;
}
