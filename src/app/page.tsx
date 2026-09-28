"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type Mode = "text" | "url" | "file";
type Result = {
  content_id: string;
  chunk_count: number;
  concepts: Array<{ name: string; summary: string; difficulty: number; source_chunk_indexes: number[] }>;
  edges: Array<{ from: number; to: number; type: string }>;
};

type ErrorPayload = { error?: string; injection_flags?: string[] };

const modes: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "text", label: "Paste text", hint: "Drop in a policy, procedure, or note." },
  { id: "url", label: "Use a URL", hint: "Fetch a public HTTP or HTTPS page." },
  { id: "file", label: "Upload file", hint: "PDF, DOCX, TXT, or Markdown up to 10 MB." },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Ready for a source");
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setStatus("Reading source...");

    try {
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      let request: RequestInit;
      if (mode === "file") {
        const body = new FormData();
        body.set("title", title);
        if (!file) throw new Error("Choose a file first");
        body.set("file", file);
        request = { method: "POST", headers, body };
      } else {
        request = {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ title, ...(mode === "text" ? { text } : { url }) }),
        };
      }

      setStatus("Extracting chunks and concepts...");
      const response = await fetch("/api/ingest", request);
      const payload = (await response.json()) as Result & ErrorPayload;
      if (!response.ok) throw payload;
      setResult(payload);
      setStatus("Source ready for a learning journey");
    } catch (caught) {
      const payload = caught as ErrorPayload;
      setError({ error: payload.error ?? (caught instanceof Error ? caught.message : "Ingestion failed"), injection_flags: payload.injection_flags });
      setStatus("Needs attention");
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f0e6] px-5 py-5 text-[#173b36] sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1440px]">
        <header className="flex items-center justify-between border-b border-[#173b36]/20 pb-5 text-xs font-semibold uppercase tracking-[0.2em]">
          <a href="/" className="text-base tracking-[0.22em]">Gamora</a>
          <span className="hidden text-[#d95f40] sm:inline">Learning experience engine / M2</span>
          <span className="rounded-full border border-[#173b36]/20 px-3 py-1 tracking-[0.12em]">Content lab</span>
        </header>

        <section className="grid gap-12 py-12 lg:grid-cols-[0.86fr_1.14fr] lg:py-20">
          <div className="flex flex-col justify-between gap-12">
            <div>
              <p className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-[#d95f40]">Turn source into signal</p>
              <h1 className="max-w-xl text-6xl font-semibold leading-[0.9] tracking-[-0.045em] sm:text-8xl">Give the work a way in.</h1>
              <p className="mt-8 max-w-md text-lg leading-7 text-[#173b36]/70">Start with trusted material. Gamora finds the teachable structure, keeps every chunk traceable, and prepares the first step of a learning journey.</p>
            </div>
            <div className="grid max-w-md grid-cols-3 gap-3 border-t border-[#173b36]/20 pt-4 text-xs uppercase tracking-[0.14em]">
              <span>01 / Parse</span><span>02 / Ground</span><span>03 / Map</span>
            </div>
          </div>

          <section className="border border-[#173b36]/20 bg-[#efe5d7] p-5 sm:p-7" aria-label="Ingestion workspace">
            <div className="mb-7 flex items-start justify-between gap-5">
              <div><p className="text-xs uppercase tracking-[0.18em] text-[#173b36]/55">New source</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Build a content map</h2></div>
              <span className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[#173b36]/55"><i className="h-2 w-2 rounded-full bg-[#5d9d73]" /> {status}</span>
            </div>
            <form onSubmit={submit} className="space-y-5">
              <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em]">Source title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="e.g. Branch fraud response policy" className="w-full border border-[#173b36]/25 bg-[#f7f0e6] px-4 py-3 outline-none transition focus:border-[#d95f40]" /></label>
              <div className="grid grid-cols-3 border-b border-[#173b36]/20">
                {modes.map((item) => <button type="button" key={item.id} onClick={() => setMode(item.id)} className={`border-b-2 px-2 py-3 text-left text-xs font-semibold uppercase tracking-[0.1em] transition ${mode === item.id ? "border-[#d95f40] text-[#d95f40]" : "border-transparent text-[#173b36]/50 hover:text-[#173b36]"}`}>{item.label}</button>)}
              </div>
              <p className="text-sm text-[#173b36]/60">{modes.find((item) => item.id === mode)?.hint}</p>
              {mode === "text" && <textarea value={text} onChange={(event) => setText(event.target.value)} required rows={8} placeholder="Paste the source material here..." className="w-full resize-y border border-[#173b36]/25 bg-[#f7f0e6] px-4 py-3 outline-none transition focus:border-[#d95f40]" />}
              {mode === "url" && <input value={url} onChange={(event) => setUrl(event.target.value)} required type="url" placeholder="https://example.com/policy" className="w-full border border-[#173b36]/25 bg-[#f7f0e6] px-4 py-3 outline-none transition focus:border-[#d95f40]" />}
              {mode === "file" && <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center border border-dashed border-[#173b36]/35 bg-[#f7f0e6] px-5 text-center hover:border-[#d95f40]"><span className="text-lg font-semibold">{file?.name ?? "Choose a source file"}</span><span className="mt-2 text-sm text-[#173b36]/55">PDF / DOCX / TXT / MD</span><input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown" onChange={chooseFile} className="sr-only" /></label>}
              <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em]">Supabase access token</span><input value={token} onChange={(event) => setToken(event.target.value)} type="password" placeholder="Required for ingestion" className="w-full border border-[#173b36]/25 bg-[#f7f0e6] px-4 py-3 outline-none transition focus:border-[#d95f40]" /><span className="mt-2 block text-xs text-[#173b36]/55">Used only for this request. Never stored by the browser.</span></label>
              <button type="submit" className="w-full bg-[#173b36] px-5 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-[#f7f0e6] transition hover:bg-[#d95f40]">Parse source <span aria-hidden="true">↗</span></button>
            </form>
            {error && <div role="alert" className="mt-5 border border-[#b44b38]/40 bg-[#f4d9cf] p-4 text-sm"><strong>{error.error}</strong>{error.injection_flags?.length ? <p className="mt-2">Instruction-like text was detected and not processed.</p> : null}</div>}
          </section>
        </section>

        {result && <section className="border-t border-[#173b36]/20 py-8" aria-live="polite"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs uppercase tracking-[0.18em] text-[#d95f40]">Source map ready</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">{result.chunk_count} chunks / {result.concepts.length} concepts</h2></div><code className="text-xs text-[#173b36]/50">{result.content_id}</code></div><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{result.concepts.map((concept, index) => <article key={`${concept.name}-${index}`} className="border border-[#173b36]/15 bg-[#efe5d7] p-4"><div className="flex justify-between text-xs uppercase tracking-[0.12em] text-[#d95f40]"><span>Concept {String(index + 1).padStart(2, "0")}</span><span>Level {concept.difficulty}</span></div><h3 className="mt-4 font-semibold">{concept.name}</h3><p className="mt-2 text-sm leading-6 text-[#173b36]/65">{concept.summary}</p><p className="mt-4 text-xs text-[#173b36]/45">Chunks: {concept.source_chunk_indexes.join(", ")}</p></article>)}</div></section>}

        <footer className="flex flex-col gap-3 border-t border-[#173b36]/20 py-5 text-xs uppercase tracking-[0.14em] text-[#173b36]/55 sm:flex-row sm:justify-between"><span>Source-grounded / Adaptive / Human</span><span>Next: journey planning</span></footer>
      </div>
    </main>
  );
}
