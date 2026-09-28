"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Alert, Button, Eyebrow, Meter } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import type { SessionPayload } from "@/lib/auth/supabase-auth";

type Journey = { id: string; title: string | null; story_theme: string; language: string; missions_total: number; missions_done: number; created_at: string };
type Content = { id: string; title: string; status: string; shared: boolean; mine: boolean; journey_id: string | null };

function Home({ session }: { session: SessionPayload }) {
  const router = useRouter();
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [library, setLibrary] = useState<Content[]>([]);
  const [building, setBuilding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [needsProfile, setNeedsProfile] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [profile, j, c] = await Promise.all([authFetch("/api/profile"), authFetch("/api/journeys"), authFetch("/api/contents")]);
        const list = j.ok ? ((await j.json()) as { journeys: Journey[] }).journeys : [];
        const onboarded = profile.ok ? ((await profile.json()) as { onboarded: boolean }).onboarded : true;
        // Only a brand new learner goes straight to onboarding. Everyone else keeps their journeys in view.
        if (!onboarded && list.length === 0) {
          router.replace("/onboarding");
          return;
        }
        setNeedsProfile(!onboarded);
        setJourneys(list);
        if (c.ok) setLibrary(((await c.json()) as { contents: Content[] }).contents.filter((item) => item.status === "ready" && !item.journey_id));
        if (!j.ok) setError("Could not load your journeys. Please refresh.");
      } catch {
        setJourneys([]);
        setError("Could not reach Gamora. Check your connection and refresh.");
      }
    })();
  }, [router]);

  async function build(contentId: string) {
    setBuilding(contentId);
    setError(null);
    const response = await authFetch("/api/journeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content_id: contentId }),
    });
    const payload = (await response.json()) as { journey_id?: string; error?: string };
    if (payload.journey_id) router.push(`/journey/${payload.journey_id}`);
    else {
      setError(payload.error ?? "Could not plan the journey");
      setBuilding(null);
    }
  }

  const name = session.user.display_name ?? session.user.email.split("@")[0];

  return (
    <div className="space-y-10">
      <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <Eyebrow>Welcome back, {name}</Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold leading-[0.95] tracking-[-0.035em] sm:text-6xl">Pick up where you left off.</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/studio" className="inline-flex min-h-11 items-center bg-ink px-5 text-sm font-semibold text-paper hover:bg-accent">
            Add new material
          </Link>
          <Link href="/onboarding" className="inline-flex min-h-11 items-center border border-ink/25 px-5 text-sm font-semibold hover:border-accent">
            Update my profile
          </Link>
        </div>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {needsProfile ? (
        <Alert tone="info">
          Tell us a little about you so journeys fit your role and time.{" "}
          <Link href="/onboarding" className="font-semibold text-accent underline underline-offset-4">
            Finish your profile
          </Link>
        </Alert>
      ) : null}

      <section aria-label="Your journeys" className="space-y-4">
        <h2 className="text-xl font-semibold">Your journeys</h2>
        {journeys === null ? (
          <p className="text-ink/60">Loading...</p>
        ) : journeys.length === 0 ? (
          <p className="text-ink/60">No journeys yet. Pick a source below or add your own material in the Studio.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {journeys.map((journey) => (
              <li key={journey.id}>
                <Link href={`/journey/${journey.id}`} className="block border border-ink/20 bg-panel p-5 hover:border-accent">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                    {journey.missions_done} of {journey.missions_total} missions / {journey.language === "roman_ur" ? "Roman Urdu" : "English"}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold">{journey.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-ink/70">{journey.story_theme}</p>
                  <div className="mt-4">
                    <Meter value={journey.missions_total ? journey.missions_done / journey.missions_total : 0} label="Journey progress" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {library.length > 0 && (
        <section aria-label="Ready to learn" className="space-y-4">
          <h2 className="text-xl font-semibold">Ready to learn</h2>
          <ul className="divide-y divide-ink/10 border border-ink/15">
            {library.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-xs text-ink/55">{item.mine ? "Your material" : "Shared by your L&D team"}</p>
                </div>
                <Button variant="secondary" disabled={building !== null} onClick={() => build(item.id)}>
                  {building === item.id ? "Planning..." : "Start a journey"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function HomePage() {
  return <AppShell>{(session) => <Home session={session} />}</AppShell>;
}
