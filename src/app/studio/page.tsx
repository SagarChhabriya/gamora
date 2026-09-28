"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { ConceptGraph } from "@/components/concept-graph";
import { useToast } from "@/components/toast";
import { Alert, Button, Card, Eyebrow, Field, Input, Textarea, cx } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";

type Mode = "text" | "url" | "file";
type Job = { id: string; content_id: string; step: string; status: string; progress: number; error: string | null; batch: number | null; batches: number | null };
type Debug = {
  content: { id: string; title: string; status: string; language: string | null; chunk_count: number };
  job: Job | null;
  chunks: Array<{ id: string; idx: number; text: string; tokens: number | null }>;
  concepts: Array<{ id: string; name: string; summary: string; difficulty: number; source_chunk_ids: string[] }>;
  edges: Array<{ from_id: string; to_id: string; type: string }>;
};
type ContentRow = { id: string; title: string; status: string; language: string | null; chunk_count: number; created_at: string; journey_id: string | null; mine: boolean; shared: boolean };

const modes: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "text", label: "Paste text", hint: "Drop in a policy, procedure, or note." },
  { id: "url", label: "Use a URL", hint: "Fetch a public HTTP or HTTPS page." },
  { id: "file", label: "Upload file", hint: "PDF, DOCX, TXT, or Markdown up to 10 MB." },
];

const stepLabels = [
  { id: "upload", label: "Read and scan" },
  { id: "chunk", label: "Split into sources" },
  { id: "concepts", label: "Find concepts" },
  { id: "link", label: "Map the order" },
  { id: "complete", label: "Ready" },
];

function stepIndex(job: Job | null, uploading: boolean) {
  if (uploading) return 0;
  if (!job) return -1;
  return Math.max(0, stepLabels.findIndex((step) => step.id === job.step));
}

function Studio() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<Debug | null>(null);
  const [contents, setContents] = useState<ContentRow[]>([]);
  const [building, setBuilding] = useState(false);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const debugRef = useRef<HTMLElement>(null);
  const toast = useToast();

  const loadContents = useCallback(async () => {
    const response = await authFetch("/api/contents");
    if (response.ok) setContents(((await response.json()) as { contents: ContentRow[] }).contents);
  }, []);

  useEffect(() => {
    // Initial fetch of the learner's sources for the list below the form.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadContents();
  }, [loadContents]);

  async function loadDebug(contentId: string) {
    setInspecting(contentId);
    try {
      const response = await authFetch(`/api/ingest/${contentId}`);
      if (!response.ok) throw new Error("Could not load this source");
      setDebug((await response.json()) as Debug);
      // Bring the map into view so the result of Inspect is visible.
      requestAnimationFrame(() => debugRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : "Could not load this source", "error");
    } finally {
      setInspecting(null);
    }
  }

  async function removeSource(content: ContentRow) {
    if (!window.confirm(`Remove "${content.title}" and any journeys built from it?`)) return;
    const response = await authFetch(`/api/contents/${content.id}`, { method: "DELETE" });
    if (response.ok) {
      if (debug?.content.id === content.id) setDebug(null);
      toast.show(`Removed "${content.title}".`, "info");
      await loadContents();
    } else toast.show("Could not remove this source.", "error");
  }

  async function runSteps(contentId: string, started: number) {
    for (let guard = 0; guard < 60; guard += 1) {
      const response = await authFetch(`/api/ingest/${contentId}/step`, { method: "POST" });
      const payload = (await response.json()) as { job?: Job; error?: string };
      if (!payload.job) throw new Error(payload.error ?? "Ingest step failed");
      setJob(payload.job);
      setElapsed(Date.now() - started);
      if (payload.job.status === "complete") return;
      if (payload.job.status === "failed") throw new Error(payload.job.error ?? "Ingest failed");
    }
    throw new Error("Ingest took too many steps");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDebug(null);
    setJob(null);
    setUploading(true);
    const started = Date.now();
    try {
      let init: RequestInit;
      if (mode === "file") {
        if (!file) throw new Error("Choose a file first");
        const body = new FormData();
        body.set("title", title);
        body.set("file", file);
        init = { method: "POST", body };
      } else {
        init = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, ...(mode === "text" ? { text } : { url }) }),
        };
      }
      const response = await authFetch("/api/ingest", init);
      const payload = (await response.json()) as { content_id?: string; job?: Job; error?: string; injection_flags?: string[]; duplicate?: boolean };
      if (!response.ok || !payload.content_id || !payload.job) {
        throw new Error(
          payload.injection_flags?.length
            ? "This source contains text that looks like instructions to an AI, so it was not processed."
            : (payload.error ?? "Upload failed"),
        );
      }
      setUploading(false);
      setJob(payload.job);
      if (payload.duplicate) toast.show("You already added this material, so the existing map is reused.", "info");
      await runSteps(payload.content_id, started);
      await loadDebug(payload.content_id);
      await loadContents();
      if (!payload.duplicate) toast.show(`Content map ready in ${((Date.now() - started) / 1000).toFixed(1)} s. You can build your journey now.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function buildJourney(contentId: string) {
    setBuilding(true);
    setError(null);
    try {
      const response = await authFetch("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_id: contentId }),
      });
      const payload = (await response.json()) as { journey_id?: string; error?: string };
      if (!response.ok || !payload.journey_id) throw new Error(payload.error ?? "Could not build the journey");
      router.push(`/journey/${payload.journey_id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build the journey");
      setBuilding(false);
    }
  }

  const current = stepIndex(job, uploading);
  const active = uploading || (job !== null && job.status !== "complete" && job.status !== "failed" && !error);

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <Eyebrow>Studio</Eyebrow>
          <h1 className="mt-4 text-4xl font-semibold leading-[0.95] tracking-[-0.035em] sm:text-6xl">Give the work a way in.</h1>
          <p className="mt-5 max-w-md text-lg leading-7 text-ink/70">
            Add trusted material. Gamora finds the teachable ideas, keeps every piece traceable to its source, and plans a journey.
          </p>
          {(job || uploading) && (
            <ol className="mt-8 space-y-3" aria-label="Processing steps" aria-live="polite">
              {stepLabels.map((step, index) => {
                const done = index < current || job?.status === "complete";
                const now = index === current && active;
                return (
                  <li key={step.id} className="flex items-center gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className={cx(
                        "grid h-6 w-6 place-items-center border text-[11px] font-semibold",
                        done ? "border-good bg-good text-paper" : now ? "animate-pulse border-accent text-accent" : "border-ink/25 text-ink/40",
                      )}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <span className={cx(done || now ? "text-ink" : "text-ink/45")}>
                      {step.label}
                      {now && step.id === "concepts" && job?.batches ? ` (${(job.batch ?? 0) + 1} of ${job.batches})` : ""}
                    </span>
                    <span className="sr-only">{done ? "done" : now ? "in progress" : "waiting"}</span>
                  </li>
                );
              })}
              <li className="pt-2">
                <div className="h-1.5 w-full max-w-sm bg-ink/10">
                  <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${uploading ? 5 : (job?.progress ?? 0)}%` }} />
                </div>
                {elapsed !== null && <p className="mt-2 text-xs text-ink/55">{(elapsed / 1000).toFixed(1)} s elapsed</p>}
              </li>
            </ol>
          )}
        </div>

        <Card>
          <form onSubmit={submit} className="space-y-5">
            <Field label="Source title">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="e.g. Branch fraud response policy" />
            </Field>
            <div className="grid grid-cols-3 border-b border-ink/20" role="tablist" aria-label="Source type">
              {modes.map((item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === item.id}
                  key={item.id}
                  onClick={() => setMode(item.id)}
                  className={cx(
                    "border-b-2 px-2 py-3 text-left text-xs font-semibold uppercase tracking-[0.1em]",
                    mode === item.id ? "border-accent text-accent" : "border-transparent text-ink/55 hover:text-ink",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-ink/60">{modes.find((item) => item.id === mode)?.hint}</p>
            {mode === "text" && (
              <Textarea aria-label="Source text" value={text} onChange={(event) => setText(event.target.value)} required rows={8} placeholder="Paste the source material here..." />
            )}
            {mode === "url" && (
              <Input aria-label="Source URL" value={url} onChange={(event) => setUrl(event.target.value)} required type="url" placeholder="https://example.com/policy" />
            )}
            {mode === "file" && (
              <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center border border-dashed border-ink/35 bg-paper px-5 text-center hover:border-accent">
                <span className="text-lg font-semibold">{file?.name ?? "Choose a source file"}</span>
                <span className="mt-2 text-sm text-ink/55">PDF / DOCX / TXT / MD</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)}
                  className="sr-only"
                />
              </label>
            )}
            <Button type="submit" disabled={active} className="w-full">
              {active ? "Working on it..." : "Build a content map"}
            </Button>
          </form>
          {error ? <div className="mt-5"><Alert>{error}</Alert></div> : null}
        </Card>
      </div>

      {debug && (
        <section ref={debugRef} aria-live="polite" className="animate-rise scroll-mt-6 space-y-6 border-t border-ink/15 pt-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <Eyebrow>Source map ready</Eyebrow>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">
                {debug.chunks.length} sources / {debug.concepts.length} concepts / {debug.edges.length} links
              </h2>
              <p className="mt-1 text-sm text-ink/60">
                Language detected: {debug.content.language ?? "unknown"}
                {elapsed !== null ? ` / processed in ${(elapsed / 1000).toFixed(1)} s` : ""}
              </p>
            </div>
            <Button onClick={() => buildJourney(debug.content.id)} disabled={building}>
              {building ? "Planning your journey..." : "Build my journey"}
            </Button>
          </div>
          <ConceptGraph concepts={debug.concepts} edges={debug.edges} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {debug.concepts.map((concept, index) => (
              <article key={concept.id} className="border border-ink/15 bg-panel p-4">
                <div className="flex justify-between text-xs uppercase tracking-[0.12em] text-accent">
                  <span>Concept {String(index + 1).padStart(2, "0")}</span>
                  <span>Level {concept.difficulty}</span>
                </div>
                <h3 className="mt-3 font-semibold">{concept.name}</h3>
                <p className="mt-2 text-sm leading-6 text-ink/70">{concept.summary}</p>
                <p className="mt-3 text-xs text-ink/50">
                  Sources: {concept.source_chunk_ids.map((id) => `#${(debug.chunks.find((chunk) => chunk.id === id)?.idx ?? 0) + 1}`).join(", ")}
                </p>
              </article>
            ))}
          </div>
          <details className="border border-ink/15 bg-panel p-4">
            <summary className="cursor-pointer text-sm font-semibold">Show source chunks (debug)</summary>
            <ol className="mt-4 space-y-3">
              {debug.chunks.map((chunk) => (
                <li key={chunk.id} className="text-sm leading-6 text-ink/75">
                  <strong className="mr-2 text-accent">#{chunk.idx + 1}</strong>
                  {chunk.text.slice(0, 400)}
                  {chunk.text.length > 400 ? "..." : ""}
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}

      {toast.view}
      <section className="space-y-4 border-t border-ink/15 pt-8">
        <h2 className="text-xl font-semibold">Your sources</h2>
        {contents.length === 0 ? (
          <p className="text-sm text-ink/60">Nothing yet. Add your first source above.</p>
        ) : (
          <ul className="divide-y divide-ink/10 border border-ink/15">
            {contents.map((content) => (
              <li key={content.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{content.title}</p>
                  <p className="text-xs text-ink/55">
                    {content.status} / {content.chunk_count} sources / {content.language ?? "unknown"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => loadDebug(content.id)} disabled={inspecting !== null} aria-busy={inspecting === content.id}>
                    {inspecting === content.id ? "Opening..." : debug?.content.id === content.id ? "Inspecting" : "Inspect"}
                  </Button>
                  {content.mine ? (
                    <Button variant="ghost" onClick={() => void removeSource(content)} aria-label={`Remove ${content.title}`}>
                      Remove
        <p className="-mt-2 text-sm text-ink/60">Only you see your sources. Sources your L&amp;D team shares with everyone are marked.</p>
                    </Button>
                  ) : null}
                  {content.journey_id ? (
                    <Link href={`/journey/${content.journey_id}`} className="inline-flex min-h-11 items-center px-4 text-sm font-semibold text-accent">
                      Open journey
                    </Link>
                  ) : content.status === "ready" ? (
                    <Button variant="secondary" onClick={() => buildJourney(content.id)} disabled={building}>
                      Build journey
                    {content.mine ? "" : "Shared by your L&D team / "}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function StudioPage() {
  return <AppShell>{() => <Studio />}</AppShell>;
}
