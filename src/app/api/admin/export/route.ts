import { NextResponse } from "next/server";
import { z } from "zod";

import { applyFilters, computeDashboard, pseudonym } from "@/lib/analytics/compute";
import { readFilters } from "@/lib/analytics/filters";
import { loadRaw } from "@/lib/analytics/load";
import { requireUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

export const runtime = "nodejs";
export const maxDuration = 30;

const tables = ["learners", "mastery", "sessions", "evidence", "friction", "funnel", "usage", "outcomes", "events"] as const;

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formula injection and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "no_rows\n";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

/** CSV export for every dashboard table. Learner IDs are pseudonymised unless reveal=1. */
export async function GET(request: Request) {
  const auth = await requireUser(request, "admin");
  if (auth.error) return auth.error;
  const table = z.enum(tables).safeParse(new URL(request.url).searchParams.get("table"));
  const parsed = readFilters(request.url);
  if (!table.success || !parsed.success) return NextResponse.json({ error: "Invalid export request" }, { status: 400 });
  const { reveal, ...filters } = parsed.data;
  const [{ config }, raw] = await Promise.all([getActiveConfig(), loadRaw()]);
  const data = applyFilters(raw, filters);
  const dashboard = computeDashboard(data, config, { reveal: reveal === "1" });
  const who = (id: string) => (reveal === "1" ? (data.profiles.find((profile) => profile.id === id)?.display_name ?? pseudonym(id)) : pseudonym(id));
  const conceptName = new Map(data.concepts.map((concept) => [concept.id, concept.name]));

  const rows: Array<Record<string, unknown>> =
    table.data === "learners"
      ? dashboard.learners
      : table.data === "mastery"
        ? data.mastery.map((row) => ({ learner: who(row.learner_id), concept: conceptName.get(row.concept_id) ?? row.concept_id, mastery: Number(row.mastery).toFixed(3), confidence: Number(row.confidence).toFixed(3), evidence_count: row.evidence_count }))
        : table.data === "sessions"
          ? data.sessions.map((row) => ({ learner: who(row.learner_id), started_at: row.started_at, ended_at: row.ended_at, completed: Boolean(row.completed_at), language: row.language, persona: row.persona }))
          : table.data === "evidence"
            ? data.evidence.map((row) => ({ learner: who(row.learner_id), concept: conceptName.get(row.concept_id) ?? row.concept_id, signal: row.signal, value: row.value, at: row.created_at }))
            : table.data === "friction"
              ? dashboard.friction
              : table.data === "funnel"
                ? dashboard.funnel
                : table.data === "usage"
                  ? [{ ...dashboard.usage, providers: dashboard.usage.providers.map((item) => `${item.provider}:${item.calls}`).join(" ") }]
                  : table.data === "outcomes"
                    ? [{ ...dashboard.outcomes, ...dashboard.quality, adaptation_reasons: dashboard.quality.adaptation_reasons.map((item) => `${item.code}:${item.count}`).join(" ") }]
                    : data.events.slice(0, 5000).map((event) => ({ type: event.type, ok: event.ok, latency_ms: event.latency_ms, provider: event.provider, tokens_in: event.tokens_in, tokens_out: event.tokens_out, at: event.created_at }));

  await logEvent({ request_id: getOrCreateRequestId(request.headers.get("x-request-id")), user_hash: auth.user.userHash, type: "admin.export", payload: { table: table.data, rows: rows.length, reveal: reveal === "1" } });
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gamora-${table.data}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
