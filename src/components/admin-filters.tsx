"use client";

import type { FilterState } from "@/lib/analytics/client";

const select = "min-h-10 border border-ink/25 bg-paper px-2 text-sm";

export function AdminFilters({
  filters,
  setFilters,
  contents,
  personas,
  hasDemo,
}: {
  filters: FilterState;
  setFilters: (next: FilterState) => void;
  contents: Array<{ id: string; title: string }>;
  personas: string[];
  hasDemo: boolean;
}) {
  const set = (key: keyof FilterState) => (event: { target: { value: string } }) => setFilters({ ...filters, [key]: event.target.value });
  return (
    <form className="flex flex-wrap items-end gap-3 border border-ink/15 bg-panel p-3 print:hidden" aria-label="Filters" onSubmit={(event) => event.preventDefault()}>
      <label className="text-xs font-semibold">
        From
        <input type="date" value={filters.from} onChange={set("from")} className={`${select} mt-1 block`} />
      </label>
      <label className="text-xs font-semibold">
        To
        <input type="date" value={filters.to} onChange={set("to")} className={`${select} mt-1 block`} />
      </label>
      <label className="text-xs font-semibold">
        Topic
        <select value={filters.content_id} onChange={set("content_id")} className={`${select} mt-1 block max-w-52`}>
          <option value="">All topics</option>
          {contents.map((content) => (
            <option key={content.id} value={content.id}>
              {content.title}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold">
        Persona
        <select value={filters.persona} onChange={set("persona")} className={`${select} mt-1 block`}>
          <option value="">All</option>
          {personas.map((persona) => (
            <option key={persona} value={persona}>
              {persona.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold">
        Language
        <select value={filters.language} onChange={set("language")} className={`${select} mt-1 block`}>
          <option value="">All</option>
          <option value="en">English</option>
          <option value="roman_ur">Roman Urdu</option>
        </select>
      </label>
      <label className="text-xs font-semibold">
        Cohort
        <select value={filters.cohort} onChange={set("cohort")} className={`${select} mt-1 block`}>
          <option value="all">All learners</option>
          <option value="real">Real usage only</option>
          {hasDemo ? <option value="demo">Demo data only</option> : null}
        </select>
      </label>
      <label className="flex min-h-10 items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={filters.reveal === "1"} onChange={(event) => setFilters({ ...filters, reveal: event.target.checked ? "1" : "0" })} className="h-4 w-4" />
        Show names (logged)
      </label>
      <button type="button" onClick={() => setFilters({ from: "", to: "", persona: "", language: "", content_id: "", cohort: "all", reveal: "0" })} className="min-h-10 px-3 text-sm text-ink/60 hover:text-accent">
        Reset
      </button>
    </form>
  );
}
