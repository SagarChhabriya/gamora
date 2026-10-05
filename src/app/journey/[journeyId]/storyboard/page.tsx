"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { showNotices, type NoticeMessage } from "@/components/llm-notices";
import { StoryboardPlayer } from "@/components/storyboard-player";
import { Alert, Eyebrow } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import type { MissionView } from "@/lib/journey/load";
import { storyboardSeenKey, type Storyboard } from "@/lib/storyboard/story";
import { useVoice } from "@/lib/voice/use-voice";


function markSeen(journeyId: string) {
  try {
    window.localStorage.setItem(storyboardSeenKey(journeyId), "1");
  } catch {
    // Private windows may block storage. The storyboard still plays.
  }
}

function StoryboardScreen() {
  const params = useParams<{ journeyId: string }>();
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [startHref, setStartHref] = useState(`/journey/${params.journeyId}`);
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const voice = useVoice(storyboard?.language ?? "en");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    // The storyboard is usually ready. If a build is still running, check again every few seconds.
    const load = async (attempt: number) => {
      const response = await authFetch(`/api/journeys/${params.journeyId}/storyboard`);
      if (cancelled) return;
      if (response.status === 202 && attempt < 30) {
        setWaited(attempt + 1);
        timer = window.setTimeout(() => void load(attempt + 1), 4_000);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { storyboard?: Storyboard; illustrating?: boolean; error?: string; notices?: NoticeMessage[] };
      showNotices(payload.notices);
      if (!response.ok || !payload.storyboard) {
        setError(payload.error ?? "Could not prepare the storyboard.");
        return;
      }
      setStoryboard(payload.storyboard);
      // Illustrations arrive after the storyboard; fetch again to pick them up while it plays.
      if (payload.illustrating || (illustrationChecks > 0 && illustrationChecks < 3 && payload.storyboard.panels.some((panel) => !panel.image_url))) {
        if (illustrationChecks < 3) timer = window.setTimeout(() => void load(attempt), 15_000);
        illustrationChecks += 1;
      }
    };
    let illustrationChecks = 0;
    void load(0).catch(() => setError("Could not reach Gamora. Check your connection and try again."));
    authFetch(`/api/journeys/${params.journeyId}`)
      .then(async (response) => (response.ok ? ((await response.json()) as { missions: MissionView[] }) : null))
      .then((payload) => {
        const first = payload?.missions.find((mission) => mission.status !== "locked" && mission.status !== "completed") ?? payload?.missions[0];
        if (first && !cancelled) setStartHref(`/journey/${params.journeyId}/mission/${first.id}`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [params.journeyId]);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Link href={`/journey/${params.journeyId}`} className="text-sm font-semibold text-accent">
          ← Back to the journey
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/journey/${params.journeyId}`} className="text-sm font-semibold text-ink/60 hover:text-accent">
            ← Journey map
          </Link>
          <Eyebrow className="mt-4">Storyboard</Eyebrow>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">{storyboard?.title ?? "Preparing your storyboard"}</h1>
          {storyboard ? <p className="mt-2 max-w-2xl text-ink/70">{storyboard.setting}</p> : null}
        </div>
      </div>
      {storyboard ? (
        <StoryboardPlayer
          storyboard={storyboard}
          startHref={startHref}
          onFinish={() => markSeen(params.journeyId)}
          speak={voice.ttsSupported ? voice.speak : undefined}
          silence={voice.silence}
        />
      ) : (
        <div className="border border-ink/15 bg-panel p-6" role="status">
          <div className="h-1.5 w-full max-w-sm overflow-hidden bg-ink/10">
            <div className="h-full w-1/3 animate-pulse bg-accent" />
          </div>
          <p className="mt-3 text-sm text-ink/65">
            Drawing each panel from your material and checking every quote against it{waited > 2 ? `, ${waited * 4} s so far` : ""}.
          </p>
        </div>
      )}
    </div>
  );
}

export default function StoryboardPage() {
  return <AppShell wide>{() => <StoryboardScreen />}</AppShell>;
}
