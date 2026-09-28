"use client";

import { useEffect, useState } from "react";

import { AdminFilters } from "@/components/admin-filters";
import { AdminNav } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { BarList, PrePost } from "@/components/charts";
import { Button } from "@/components/ui";
import { emptyFilters, filterQuery, type FilterState } from "@/lib/analytics/client";
import type { Dashboard } from "@/lib/analytics/compute";
import { authFetch } from "@/lib/auth/client";

type Payload = { dashboard: Dashboard; options: { contents: Array<{ id: string; title: string }>; personas: string[]; has_demo: boolean }; generated_at: string };

const formatMinutes = (value: number) => (value >= 2_880 ? `${(value / 1_440).toFixed(1)} days` : value >= 120 ? `${(value / 60).toFixed(1)} hours` : `${value.toFixed(1)} min`);
const pct = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : `${Math.round(value * 100)}%`);

/** Outcome report. Print-ready layout; "Save as PDF" uses the browser's print to PDF. */
function Report() {
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    authFetch(`/api/admin/analytics?${filterQuery(filters)}`)
      .then((response) => response.json())
      .then((payload: Payload) => setData(payload))
      .catch(() => setData(null));
  }, [filters]);

  if (!data) return <p className="text-ink/60">Loading report...</p>;
  const d = data.dashboard;
  const topic = data.options.contents.find((content) => content.id === filters.content_id)?.title ?? "All topics";
  const range = filters.from || filters.to ? `${filters.from || "start"} to ${filters.to || "today"}` : "All time";

  return (
    <div className="space-y-6">
      <AdminFilters filters={filters} setFilters={setFilters} contents={data.options.contents} personas={data.options.personas} hasDemo={data.options.has_demo} />
      <div className="flex justify-end print:hidden">
        <Button onClick={() => window.print()}>Save as PDF / Print</Button>
      </div>
      <article className="mx-auto max-w-3xl space-y-8 bg-paper print:max-w-none" aria-label="Outcome report">
        <header className="border-b-2 border-ink pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Gamora outcome report</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">{topic}</h1>
          <p className="mt-1 text-sm text-ink/70">
            {range} / Cohort: {filters.cohort === "demo" ? "demo data only" : filters.cohort === "real" ? "real usage only" : "all learners"}
            {filters.persona ? ` / Persona: ${filters.persona.replace("_", " ")}` : ""}
            {filters.language ? ` / Language: ${filters.language === "roman_ur" ? "Roman Urdu" : "English"}` : ""}
          </p>
          <p className="text-xs text-ink/55">Generated {new Date(data.generated_at).toLocaleString()}. Learners are pseudonymised.</p>
          {data.options.has_demo && filters.cohort !== "real" ? <p className="mt-2 text-xs font-semibold text-accent">Contains synthetic demo data, clearly labeled.</p> : null}
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Did people learn?</h2>
          <PrePost pre={d.outcomes.pre_mastery} post={d.outcomes.post_mastery} />
          <p className="text-sm leading-6">
            Across {d.outcomes.learner_concepts} learner-concept pairs, estimated mastery moved from <strong>{pct(d.outcomes.pre_mastery)}</strong> after the first piece of evidence to{" "}
            <strong>{pct(d.outcomes.post_mastery)}</strong> now, an average gain of <strong>{Math.round(d.outcomes.avg_gain * 100)} points</strong>. {d.outcomes.reached_threshold} reached the unlock level, with a median of{" "}
            {d.outcomes.time_to_mastery_min === null ? "n/a" : formatMinutes(d.outcomes.time_to_mastery_min)} from first attempt.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Did they stay engaged?</h2>
          <BarList label="Engagement funnel" rows={d.funnel.map((row) => ({ label: row.stage, value: row.count }))} />
          <p className="text-sm leading-6">
            {d.overview.active_learners} active learners ran {d.overview.sessions} sessions (average {d.overview.avg_session_minutes.toFixed(1)} minutes). Mission completion rate: <strong>{pct(d.overview.completion_rate)}</strong>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Where did they struggle?</h2>
          <BarList label="Friction by concept" rows={d.friction.slice(0, 6).map((row) => ({ label: row.concept, value: row.friction, detail: `${row.hints} hints, ${row.errors} errors` }))} format={pct} />
          <p className="text-sm leading-6">Recommendation: review the source material for the top friction concepts. Recovery after a difficulty drop was {pct(d.quality.recovery_rate)} (n={d.quality.recovery_sample}).</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Could we trust it?</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            <li>Grounding verifier pass rate: {pct(d.quality.grounding_pass_rate)} across {d.quality.grounding_checks} checks. Activities that failed twice were replaced with direct source quotes ({d.quality.abstains}).</li>
            <li>Learner questions answered from the source: {d.quality.question_abstain_rate === null ? "n/a" : pct(1 - d.quality.question_abstain_rate)} of {d.quality.questions}. The rest were declined as not covered.</li>
            <li>Confidence calibration: {pct(d.outcomes.calibration_rate)} of confidence checks matched demonstrated performance.</li>
            <li>
              Performance: turn latency p50 {Math.round(d.usage.turn_p50_ms)} ms, p95 {Math.round(d.usage.turn_p95_ms)} ms. {d.usage.llm_calls} model calls, {d.usage.fallback_calls} served by the fallback provider, {d.usage.errors} errors.
            </li>
          </ul>
        </section>

        <footer className="border-t border-ink/20 pt-3 text-xs text-ink/60">
          Mastery is a weighted evidence estimate with forgetting decay, built for explainability. It is not a psychometrically validated score.
        </footer>
      </article>
    </div>
  );
}

export default function ReportPage() {
  return (
    <AppShell requireRole="admin" wide>
      {() => (
        <>
          <AdminNav />
          <Report />
        </>
      )}
    </AppShell>
  );
}
