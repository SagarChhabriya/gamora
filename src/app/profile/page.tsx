"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { Alert, Button, Card, Eyebrow, cx } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";

type Topics = { value: number; custom: number | null; default: number; max: number; min: number };
type Payload = { profile?: { language_pref: string; time_budget_min: number }; topics: Topics };

const minuteChoices = [5, 10, 15, 30, 45, 60];

function Preferences() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useDefault, setUseDefault] = useState(true);
  const [cap, setCap] = useState(12);
  const [language, setLanguage] = useState<"en" | "roman_ur">("en");
  const [minutes, setMinutes] = useState(15);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    authFetch("/api/profile")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load your preferences");
        const payload = (await response.json()) as Payload;
        setData(payload);
        setUseDefault(payload.topics.custom === null);
        setCap(payload.topics.value);
        setLanguage(payload.profile?.language_pref === "roman_ur" ? "roman_ur" : "en");
        setMinutes(payload.profile?.time_budget_min ?? 15);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load your preferences"));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    const response = await authFetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic_cap: useDefault ? null : cap, language_pref: language, time_budget_min: minutes }),
    });
    setSaving(false);
    if (response.ok) toast.show("Saved. New uploads use these settings.");
    else setError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save your preferences");
  }

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-ink/60">Loading your preferences...</p>;
  const topics = data.topics;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Eyebrow>Profile</Eyebrow>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">Learning preferences</h1>
        <p className="mt-3 text-ink/70">These shape every new source and journey you create.</p>
      </div>

      <Card>
        <h2 className="text-lg font-semibold">Topics per source</h2>
        <p className="mt-1 text-sm leading-6 text-ink/65">
          Long material is grouped into at most this many topics. Each topic keeps the smaller ideas it covers as key points, so nothing is lost. Short material keeps its natural size.
        </p>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={useDefault} onChange={(event) => setUseDefault(event.target.checked)} />
          Use the standard limit ({topics.default} topics)
        </label>
        <div className={cx("mt-4 space-y-2", useDefault && "opacity-50")}>
          <label htmlFor="topic-cap" className="flex items-center justify-between text-sm font-medium">
            <span>My limit</span>
            <span className="text-2xl font-semibold tabular-nums">{cap}</span>
          </label>
          <input
            id="topic-cap"
            type="range"
            min={topics.min}
            max={topics.max}
            value={cap}
            disabled={useDefault}
            onChange={(event) => setCap(Number(event.target.value))}
            className="w-full accent-[var(--accent)]"
            aria-valuetext={`${cap} topics`}
          />
          <div className="flex justify-between text-xs text-ink/55">
            <span>{topics.min}, quick overview</span>
            <span>{topics.max}, fine detail</span>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-ink/60">
          Sources you already added keep their topics. To apply a new limit to one of them, use Re-group on that source in the{" "}
          <Link href="/studio" className="font-semibold text-accent underline">
            Studio
          </Link>
          .
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Language</h2>
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Language">
          {(["en", "roman_ur"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              onClick={() => setLanguage(option)}
              className={cx("min-h-11 border px-3 text-sm font-semibold", language === option ? "border-accent bg-accent text-paper" : "border-ink/25 bg-paper")}
            >
              {option === "en" ? "English" : "Roman Urdu"}
            </button>
          ))}
        </div>
        <h2 className="mt-6 text-lg font-semibold">Time for a session</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Minutes per session">
          {minuteChoices.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={minutes === option}
              onClick={() => setMinutes(option)}
              className={cx("min-h-11 min-w-16 border px-3 text-sm font-semibold", minutes === option ? "border-accent bg-accent text-paper" : "border-ink/25 bg-paper")}
            >
              {option} min
            </button>
          ))}
        </div>
      </Card>

      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving..." : "Save preferences"}
        </Button>
        <Link href="/onboarding" className="text-sm font-semibold text-ink/65 hover:text-accent">
          Redo the intro chat
        </Link>
      </div>
      {toast.view}
    </div>
  );
}

export default function ProfilePage() {
  return <AppShell>{() => <Preferences />}</AppShell>;
}
