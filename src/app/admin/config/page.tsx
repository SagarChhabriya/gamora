"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminNav } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Alert, Button, Card, Eyebrow, Textarea, cx } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import { activityTypes, personaLabels, personas, type AppConfig } from "@/lib/config/schema";

type Version = { version: number; note: string | null; is_active: boolean; created_at: string; author: string; diff: Array<{ path: string; from: unknown; to: unknown }> };
type Payload = { active: AppConfig; active_version: number; defaults: AppConfig; versions: Version[] };

type Field =
  | { path: string; label: string; kind: "number"; min: number; max: number; step?: number; hint?: string }
  | { path: string; label: string; kind: "select"; options: string[]; labels?: Record<string, string>; hint?: string }
  | { path: string; label: string; kind: "toggle"; hint?: string }
  | { path: string; label: string; kind: "text"; hint?: string }
  | { path: string; label: string; kind: "multi"; options: string[]; hint?: string }
  | { path: string; label: string; kind: "list"; hint?: string };

const groups: Array<{ title: string; description: string; fields: Field[] }> = [
  {
    title: "Learner and language",
    description: "Who the default learner is and how the tutor speaks.",
    fields: [
      { path: "learner.default_level", label: "Default starting level", kind: "number", min: 1, max: 5 },
      { path: "learner.default_persona", label: "Default learner type", kind: "select", options: [...personas], labels: personaLabels },
      { path: "learner.session_minutes", label: "Default session length (minutes)", kind: "number", min: 3, max: 120 },
      { path: "learner.minutes_per_mission", label: "Minutes per mission", kind: "number", min: 2, max: 30 },
      { path: "language.default", label: "Default language", kind: "select", options: ["en", "roman_ur"] },
      { path: "language.allowed", label: "Allowed languages", kind: "multi", options: ["en", "roman_ur"] },
      { path: "language.code_switch_level", label: "Code-switching in Roman Urdu mode", kind: "select", options: ["low", "medium", "high"] },
    ],
  },
  {
    title: "Tone",
    description: "The guide's voice. Applies on the next turn.",
    fields: [
      { path: "tone.persona_name", label: "Guide name", kind: "text" },
      { path: "tone.formality", label: "Formality", kind: "select", options: ["casual", "friendly", "formal"] },
      { path: "tone.humor", label: "Humour", kind: "select", options: ["none", "light"] },
      { path: "tone.max_words", label: "Max words per message", kind: "number", min: 30, max: 250, step: 5 },
    ],
  },
  {
    title: "Difficulty and adaptation",
    description: "The range the policy may move within, and how quickly it reacts.",
    fields: [
      { path: "difficulty.min", label: "Minimum difficulty", kind: "number", min: 1, max: 5 },
      { path: "difficulty.max", label: "Maximum difficulty", kind: "number", min: 1, max: 5 },
      { path: "difficulty.step", label: "Step size", kind: "number", min: 1, max: 2 },
      { path: "difficulty.sensitivity", label: "Adaptation sensitivity", kind: "select", options: ["low", "medium", "high"], hint: "High raises difficulty after one strong answer, low after three." },
    ],
  },
  {
    title: "Mechanics and gamification",
    description: "Which activity types appear, and what earns XP.",
    fields: [
      { path: "mechanics.enabled_activities", label: "Enabled activity types", kind: "multi", options: [...activityTypes] },
      { path: "mechanics.xp.correct", label: "XP for a correct answer", kind: "number", min: 0, max: 100 },
      { path: "mechanics.xp.self_corrected", label: "XP for self correction", kind: "number", min: 0, max: 100 },
      { path: "mechanics.xp.mission_complete", label: "XP for a mission", kind: "number", min: 0, max: 500 },
      { path: "mechanics.streak_grace_days", label: "Streak grace days", kind: "number", min: 0, max: 7 },
      { path: "mechanics.leaderboard", label: "Leaderboard (off by default, no pressure)", kind: "toggle" },
      { path: "mechanics.storyboard", label: "Storyboard before the first mission", kind: "toggle" },
      { path: "mechanics.storyboard_panels", label: "Storyboard panels", kind: "number", min: 3, max: 8 },
      { path: "mechanics.capstone", label: "Capstone case at the end of a journey", kind: "toggle", hint: "One case that needs two or more topics at once." },
      { path: "mechanics.crossroads", label: "Crossroads decisions", kind: "toggle", hint: "At most one per mission. The choice carries into the next step." },
    ],
  },
  {
    title: "Sources",
    description: "How long material is broken into topics.",
    fields: [
      { path: "content.topics_default", label: "Topics per source (default)", kind: "number", min: 3, max: 40, hint: "Long sources are grouped into at most this many topics." },
      { path: "content.topics_max", label: "Highest limit a learner may choose", kind: "number", min: 3, max: 40 },
    ],
  },
  {
    title: "Mastery thresholds",
    description: "When stages unlock and how fast knowledge fades.",
    fields: [
      { path: "mastery.unlock_threshold", label: "Unlock next mission at", kind: "number", min: 0.3, max: 0.95, step: 0.05 },
      { path: "mastery.mastered_threshold", label: "Concept counts as mastered at", kind: "number", min: 0.5, max: 1, step: 0.05 },
      { path: "mastery.decay_per_day", label: "Forgetting decay per day", kind: "number", min: 0, max: 0.2, step: 0.01 },
      { path: "mastery.step", label: "Evidence step size", kind: "number", min: 0.05, max: 0.5, step: 0.05 },
    ],
  },
  {
    title: "Grounding and safety",
    description: "Key rules. The tutor never teaches beyond the source.",
    fields: [
      { path: "grounding.must_cite", label: "Every answer must cite the source", kind: "toggle" },
      { path: "grounding.verifier", label: "Verifier strictness", kind: "select", options: ["off", "lenient", "strict"] },
      { path: "grounding.abstain_message", label: "Message when material does not cover a question", kind: "text" },
      { path: "safety.blocked_topics", label: "Blocked topics (comma separated)", kind: "list" },
      {
        path: "content.url_domains",
        label: "Websites allowed for URL sources",
        kind: "list",
        hint: "Comma separated. A domain includes its subdomains. Leave empty to allow any public site.",
      },
      { path: "safety.tutor_rpm", label: "Tutor requests per minute per learner", kind: "number", min: 5, max: 120 },
      { path: "ui.text_only_default", label: "Start learners in text only mode", kind: "toggle" },
      { path: "ui.celebrations", label: "Celebrations on milestones", kind: "toggle" },
    ],
  },
];

function get(object: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), object);
}

function set<T>(object: T, path: string, value: unknown): T {
  const copy = structuredClone(object) as Record<string, unknown>;
  const keys = path.split(".");
  let cursor = copy;
  keys.slice(0, -1).forEach((key) => {
    cursor[key] = { ...(cursor[key] as Record<string, unknown>) };
    cursor = cursor[key] as Record<string, unknown>;
  });
  cursor[keys[keys.length - 1]] = value;
  return copy as T;
}

const input = "min-h-10 w-full border border-ink/25 bg-paper px-3 text-sm outline-none focus:border-accent";

function FieldControl({ field, value, onChange }: { field: Field; value: unknown; onChange: (value: unknown) => void }) {
  const id = `f-${field.path}`;
  return (
    <div className="grid gap-1 sm:grid-cols-[1fr_14rem] sm:items-center sm:gap-4">
      <label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.hint ? <span className="block text-xs font-normal text-ink/55">{field.hint}</span> : null}
      </label>
      {field.kind === "number" ? (
        <input id={id} type="number" min={field.min} max={field.max} step={field.step ?? 1} value={Number(value)} onChange={(event) => onChange(Number(event.target.value))} className={input} />
      ) : field.kind === "select" ? (
        <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)} className={input}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {field.labels?.[option] ?? option.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      ) : field.kind === "toggle" ? (
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" />
      ) : field.kind === "text" ? (
        <input id={id} type="text" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={input} />
      ) : field.kind === "list" ? (
        <input
          id={id}
          type="text"
          value={((value as string[]) ?? []).join(", ")}
          onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
          className={input}
        />
      ) : (
        <div id={id} role="group" aria-label={field.label} className="flex flex-wrap gap-1">
          {field.options.map((option) => {
            const list = (value as string[]) ?? [];
            const on = list.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? list.filter((item) => item !== option) : [...list, option])}
                className={cx("border px-2 py-1 text-xs", on ? "border-accent bg-accent text-paper" : "border-ink/25 bg-paper text-ink/60")}
              >
                {option.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfigEditor() {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [raw, setRaw] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string; issues?: Array<{ path: string; message: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await authFetch("/api/admin/config");
    if (!response.ok) {
      setMessage({ tone: "error", text: "Could not load the configuration" });
      return;
    }
    const payload = (await response.json()) as Payload;
    setData(payload);
    setDraft(payload.active);
    setRaw(JSON.stringify(payload.active, null, 2));
  }

  useEffect(() => {
    // Initial load of the active configuration and history.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const changed = useMemo(() => (data && draft ? JSON.stringify(data.active) !== JSON.stringify(draft) : false), [data, draft]);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const response = await authFetch("/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json()) as { version?: number; diff?: unknown[]; error?: string; issues?: Array<{ path: string; message: string }> };
    setBusy(false);
    if (!response.ok) {
      setMessage({ tone: "error", text: payload.error ?? "Save failed", issues: payload.issues });
      return;
    }
    setMessage({ tone: "info", text: `Saved as version ${payload.version} with ${payload.diff?.length ?? 0} changes. Learners get it on their next turn, no redeploy.` });
    setNote("");
    await load();
  }

  if (!data || !draft) return <p className="text-ink/60">Loading configuration...</p>;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <header>
          <Eyebrow>Configuration</Eyebrow>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">Change how Gamora teaches</h1>
          <p className="mt-2 text-ink/70">Active version {data.active_version || "defaults"}. Every save is a new version with author, time and diff. Rollback is one click.</p>
        </header>
        {message ? (
          <Alert tone={message.tone}>
            {message.text}
            {message.issues?.length ? (
              <ul className="mt-2 list-disc pl-5">
                {message.issues.map((issue) => (
                  <li key={issue.path}>
                    <code>{issue.path}</code>: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        {!showRaw &&
          groups.map((group) => (
            <Card key={group.title} className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{group.title}</h2>
                <p className="text-sm text-ink/60">{group.description}</p>
              </div>
              {group.fields.map((field) => (
                <FieldControl
                  key={field.path}
                  field={field}
                  value={get(draft, field.path)}
                  onChange={(value) => {
                    const next = set(draft, field.path, value);
                    setDraft(next);
                    setRaw(JSON.stringify(next, null, 2));
                  }}
                />
              ))}
            </Card>
          ))}
        {showRaw ? (
          <Card className="space-y-2">
            <label htmlFor="raw" className="text-sm font-semibold">
              Full configuration (JSON, validated on save)
            </label>
            <Textarea
              id="raw"
              rows={28}
              value={raw}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => {
                setRaw(event.target.value);
                try {
                  setDraft(JSON.parse(event.target.value) as AppConfig);
                } catch {
                  // Keep typing, validation happens on save.
                }
              }}
            />
          </Card>
        ) : null}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-ink/15 bg-paper py-3">
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="What changed and why (optional)" aria-label="Change note" className="min-h-11 min-w-0 flex-1 border border-ink/25 bg-paper px-3 text-sm" />
          <Button disabled={busy || !changed} onClick={() => void save({ config: showRaw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : draft, note: note || undefined })}>
            {busy ? "Saving..." : "Save new version"}
          </Button>
          <Button variant="secondary" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? "Form view" : "Advanced JSON"}
          </Button>
          <Button variant="ghost" disabled={!changed} onClick={() => { setDraft(data.active); setRaw(JSON.stringify(data.active, null, 2)); }}>
            Discard
          </Button>
        </div>
      </div>

      <aside aria-label="Version history" className="space-y-3">
        <h2 className="text-lg font-semibold">Version history</h2>
        {data.versions.length === 0 ? <p className="text-sm text-ink/60">No saved versions yet. Built-in defaults are active.</p> : null}
        <ol className="space-y-3">
          {data.versions.map((version) => (
            <li key={version.version} className={cx("border p-3 text-sm", version.is_active ? "border-good bg-paper" : "border-ink/15 bg-panel")}>
              <div className="flex items-center justify-between gap-2">
                <strong>
                  v{version.version} {version.is_active ? <span className="ml-1 text-xs text-good">active</span> : null}
                </strong>
                {!version.is_active ? (
                  <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" disabled={busy} onClick={() => void save({ config: null, rollback_to: version.version })}>
                    Roll back to this
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-ink/60">
                {version.author}, {new Date(version.created_at).toLocaleString()}
              </p>
              {version.note ? <p className="mt-1">{version.note}</p> : null}
              {version.diff.length ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {version.diff.slice(0, 6).map((change) => (
                    <li key={change.path}>
                      <code>{change.path}</code>: {JSON.stringify(change.from)} → <strong>{JSON.stringify(change.to)}</strong>
                    </li>
                  ))}
                  {version.diff.length > 6 ? <li>and {version.diff.length - 6} more</li> : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

export default function ConfigPage() {
  return (
    <AppShell requireRole="admin" wide>
      {() => (
        <>
          <AdminNav />
          <ConfigEditor />
        </>
      )}
    </AppShell>
  );
}
