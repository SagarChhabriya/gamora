"use client";

import { useEffect, useState } from "react";

import { AdminFilters } from "@/components/admin-filters";
import { AdminNav } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { BarList, Funnel, Heatmap, PrePost, StatTile } from "@/components/charts";
import { Alert, Button, Card, Eyebrow } from "@/components/ui";
import { downloadCsv, emptyFilters, filterQuery, type FilterState } from "@/lib/analytics/client";
import type { Dashboard } from "@/lib/analytics/compute";
import { authFetch } from "@/lib/auth/client";

type Payload = { dashboard: Dashboard; options: { contents: Array<{ id: string; title: string }>; personas: string[]; has_demo: boolean }; generated_at: string };
type Health = { status: string; checks: Record<string, string> };

const formatMinutes = (value: number) => (value >= 2_880 ? `${(value / 1_440).toFixed(1)} days` : value >= 120 ? `${(value / 60).toFixed(1)} hours` : `${value.toFixed(1)} min`);
const pct = (value: number | null | undefined) => (value === null || value === undefined ? "n/a" : `${Math.round(value * 100)}%`);
const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`);

const reasonLabels: Record<string, string> = {
  raise_difficulty: "Raised difficulty",
  lower_difficulty: "Lowered difficulty",
  shorten: "Shortened, gave choices",
  language_switch: "Switched language",
  recovered: "Back to open questions",
  self_corrected: "Self correction noticed",
  revisit: "Scheduled a revisit",
  persona_switch: "Persona switched",
  text_only: "Text only toggled",
};

function Section({ title, children, table, filters, note }: { title: string; children: React.ReactNode; table?: string; filters: FilterState; note?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {table ? (
          <Button
            variant="ghost"
            className="min-h-9 px-2 py-1 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await downloadCsv(table, filters).catch(() => undefined);
              setBusy(false);
            }}
          >
            {busy ? "Exporting..." : "Export CSV"}
          </Button>
        ) : null}
      </div>
      {note ? <p className="text-xs text-ink/60">{note}</p> : null}
      {children}
    </Card>
  );
}

function AdminDashboard() {
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [data, setData] = useState<Payload | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    authFetch(`/api/admin/analytics?${filterQuery(filters)}`)
      .then(async (response) => {
        const payload = (await response.json()) as Payload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load analytics");
        if (active) {
          setData(payload);
          setError(null);
        }
      })
      .catch((caught: unknown) => active && setError(caught instanceof Error ? caught.message : "Could not load analytics"));
    return () => {
      active = false;
    };
  }, [filters]);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((payload: Health) => setHealth(payload))
      .catch(() => setHealth(null));
  }, []);

  const d = data?.dashboard;
  const demoShown = data?.options.has_demo && filters.cohort !== "real";

  return (
    <div className="space-y-6">
      <AdminNav />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Learning dashboard</Eyebrow>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">Learning, engagement, outcomes</h1>
        </div>
        {demoShown ? (
          <p className="border border-accent/50 bg-paper px-3 py-2 text-xs font-semibold text-accent" role="note">
            Includes synthetic demo data. Use Cohort: Real usage only to exclude it.
          </p>
        ) : null}
      </header>
      {data ? <AdminFilters filters={filters} setFilters={setFilters} contents={data.options.contents} personas={data.options.personas} hasDemo={data.options.has_demo} /> : null}
      {error ? <Alert>{error}</Alert> : null}
      {!d ? (
        <p className="text-ink/60">Loading analytics...</p>
      ) : (
        <>
          <section aria-label="Overview" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Active learners" value={d.overview.active_learners} />
            <StatTile label="Sessions" value={d.overview.sessions} hint={`${d.overview.avg_session_minutes.toFixed(1)} min average`} />
            <StatTile label="Mission completion" value={pct(d.overview.completion_rate)} hint={`${d.overview.missions_completed} missions completed`} />
            <StatTile label="Avg mastery gain" value={`+${Math.round(d.overview.avg_mastery_gain * 100)} pts`} hint="From first evidence to latest, per concept" />
          </section>

          <Section title="Mastery heatmap" table="mastery" filters={filters} note="Estimated silently from answers, choices, self correction, hints and recall. No quizzes.">
            <Heatmap concepts={d.heatmap.concepts} rows={d.heatmap.rows} />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Engagement funnel" table="funnel" filters={filters}>
              <Funnel stages={d.funnel} />
            </Section>
            <Section title="Learning friction" table="friction" filters={filters} note="Concepts ranked by hints and errors per attempt. Good candidates for better source material.">
              <BarList label="Friction by concept" rows={d.friction.map((row) => ({ label: row.concept, value: row.friction, detail: `${row.hints} hints, ${row.errors} errors, ${row.attempts} attempts` }))} format={pct} />
            </Section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Outcomes" table="outcomes" filters={filters}>
              <PrePost pre={d.outcomes.pre_mastery} post={d.outcomes.post_mastery} />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-ink/60">Median time to unlock level</dt>
                  <dd className="font-semibold">{d.outcomes.time_to_mastery_min === null ? "n/a" : formatMinutes(d.outcomes.time_to_mastery_min)}</dd>
                </div>
                <div>
                  <dt className="text-ink/60">Confidence calibrated</dt>
                  <dd className="font-semibold">{pct(d.outcomes.calibration_rate)}</dd>
                </div>
                <div>
                  <dt className="text-ink/60">Recovery after a difficulty drop</dt>
                  <dd className="font-semibold">
                    {pct(d.quality.recovery_rate)} <span className="font-normal text-ink/55">(n={d.quality.recovery_sample})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/60">Learner concepts measured</dt>
                  <dd className="font-semibold">{d.outcomes.learner_concepts}</dd>
                </div>
              </dl>
            </Section>
            <Section title="Adaptation decisions" filters={filters} note="Every change the tutor made, from the rule table. Each one was shown to the learner with a reason.">
              <BarList label="Adaptations by reason" rows={d.quality.adaptation_reasons.map((row) => ({ label: reasonLabels[row.code] ?? row.code, value: row.count }))} />
            </Section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Usage and performance" table="usage" filters={filters}>
              <section aria-label="Performance" className="grid grid-cols-2 gap-3">
                <StatTile label="Turn latency p50 / p95" value={`${ms(d.usage.turn_p50_ms)} / ${ms(d.usage.turn_p95_ms)}`} />
                <StatTile label="LLM latency p50 / p95" value={`${ms(d.usage.llm_p50_ms)} / ${ms(d.usage.llm_p95_ms)}`} />
                <StatTile label="LLM calls" value={d.usage.llm_calls} hint={`${d.usage.llm_errors} errors, ${d.usage.fallback_calls} served by fallback, ${d.usage.cached_calls} cached`} />
                <StatTile label="Tokens / est. cost" value={`${Math.round((d.usage.tokens_in + d.usage.tokens_out) / 1000)}k`} hint={`$${d.usage.est_cost_usd.toFixed(3)} at list price (paid Groq tier).`} />
              </section>
              <BarList label="Provider mix" rows={d.usage.providers.map((row) => ({ label: row.provider, value: row.calls }))} />
              <section aria-label="Voice and images" className="grid grid-cols-2 gap-3">
                <StatTile label="Cloud voice clips" value={d.usage.tts_clips} hint={`$${d.usage.tts_cost_usd.toFixed(3)} at list price. ${d.usage.tts_fallbacks} fell back to the device voice.`} />
                <StatTile label="Images made" value={d.usage.images_made} hint={`$${d.usage.image_cost_usd.toFixed(2)} at list price, shared by every learner of a source. ${d.usage.images_failed} failed.`} />
              </section>
            </Section>
            <Section title="Re-engagement" filters={filters} note="Nudges come from the daily job when topics fade, within the cadence set in Configuration. A review counts when the learner starts it from the home card.">
              <section aria-label="Nudges" className="grid grid-cols-2 gap-3">
                <StatTile label="Nudges sent / seen" value={`${d.engagement.nudges_sent} / ${d.engagement.nudges_seen}`} />
                <StatTile label="Reviews started" value={d.engagement.reviews_started} hint={`${d.engagement.reviews_from_nudge} after a nudge, ${d.engagement.dismissed} cards put off for later`} />
                <StatTile label="Nudge to review rate" value={pct(d.engagement.nudge_return_rate)} hint="The share of nudges that brought a learner back into a review." />
              </section>
            </Section>
            <Section title="Grounding and system health" table="events" filters={filters}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-ink/60">Verifier pass rate</dt>
                  <dd className="font-semibold">
                    {pct(d.quality.grounding_pass_rate)} <span className="font-normal text-ink/55">({d.quality.grounding_checks} checks)</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/60">Abstained activities</dt>
                  <dd className="font-semibold">{d.quality.abstains}</dd>
                </div>
                <div>
                  <dt className="text-ink/60">Replies rated useful</dt>
                  <dd className="font-semibold">
                    {pct(d.quality.replies_useful_rate)} <span className="font-normal text-ink/55">({d.quality.replies_rated} ratings)</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/60">Questions answered from source</dt>
                  <dd className="font-semibold">
                    {d.quality.question_abstain_rate === null ? "n/a" : pct(1 - d.quality.question_abstain_rate)} <span className="font-normal text-ink/55">of {d.quality.questions}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/60">Errors logged</dt>
                  <dd className="font-semibold">{d.usage.errors}</dd>
                </div>
              </dl>
              <ul className="flex flex-wrap gap-2 text-xs" aria-label="Service health">
                {health
                  ? Object.entries(health.checks).map(([key, value]) => (
                      <li key={key} className="border border-ink/20 px-2 py-1">
                        {value === "ok" || value === "configured" ? "● " : "○ "}
                        {key}: <strong>{value}</strong>
                      </li>
                    ))
                  : null}
              </ul>
            </Section>
          </div>

          <Section title="Learners" table="learners" filters={filters} note={filters.reveal === "1" ? "Names shown. This view was logged." : "Pseudonymised. Tick Show names to reveal, which is logged."}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.1em] text-ink/60">
                  <tr>
                    <th className="py-2">Learner</th>
                    <th>Persona</th>
                    <th>Language</th>
                    <th className="text-right">Sessions</th>
                    <th className="text-right">Missions</th>
                    <th className="text-right">Avg mastery</th>
                    <th className="text-right">Mastered</th>
                  </tr>
                </thead>
                <tbody>
                  {d.learners.map((row) => (
                    <tr key={row.learner} className="border-t border-ink/10">
                      <td className="py-2 font-medium">
                        {row.learner}
                        {row.demo ? <span className="ml-2 border border-accent/40 px-1 text-[10px] font-semibold uppercase text-accent">demo</span> : null}
                      </td>
                      <td>{row.persona.replace("_", " ")}</td>
                      <td>{row.language === "roman_ur" ? "Roman Urdu" : "English"}</td>
                      <td className="text-right tabular-nums">{row.sessions}</td>
                      <td className="text-right tabular-nums">{row.missions_completed}</td>
                      <td className="text-right tabular-nums">{pct(row.avg_mastery)}</td>
                      <td className="text-right tabular-nums">{row.concepts_mastered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              {["sessions", "evidence"].map((table) => (
                <Button key={table} variant="secondary" className="text-xs" onClick={() => void downloadCsv(table, filters)}>
                  Export {table} CSV
                </Button>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <AppShell requireRole="admin" wide>
      {() => <AdminDashboard />}
    </AppShell>
  );
}
