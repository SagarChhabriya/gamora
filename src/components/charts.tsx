import type { ReactNode } from "react";

import { cx } from "@/components/ui";

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="border border-ink/15 bg-panel p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink/55">{hint}</p> : null}
    </div>
  );
}

/**
 * Horizontal single-series bars. One hue (ink), values direct-labeled in text color,
 * native tooltip on hover and focus for the exact value.
 */
export function BarList({
  rows,
  format = (value) => String(value),
  max,
  label,
}: {
  rows: Array<{ label: string; value: number; detail?: string }>;
  format?: (value: number) => string;
  max?: number;
  label: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="text-sm text-ink/55">No data for these filters yet.</p>;
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} tabIndex={0} title={`${row.label}: ${format(row.value)}${row.detail ? ` (${row.detail})` : ""}`} className="group grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <span className="truncate text-ink/80">{row.label}</span>
          <span className="h-3 bg-ink/[0.06]">
            <span
              className="block h-full rounded-r-[4px] bg-ink/70 transition-colors group-hover:bg-ink"
              style={{ width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / top) * 100)}%` }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Sequential single-hue scale (good green), light to dark. Empty cells are neutral. */
function cellClass(value: number | null) {
  if (value === null) return "bg-transparent text-ink/30";
  if (value >= 0.8) return "bg-good text-paper";
  if (value >= 0.6) return "bg-good/75 text-paper";
  if (value >= 0.4) return "bg-good/50 text-ink";
  if (value >= 0.2) return "bg-good/30 text-ink";
  return "bg-good/12 text-ink";
}

export function Heatmap({ concepts, rows }: { concepts: Array<{ id: string; name: string }>; rows: Array<{ learner: string; values: Array<number | null> }> }) {
  if (!rows.length || !concepts.length) return <p className="text-sm text-ink/55">No mastery evidence for these filters yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-xs">
        <caption className="sr-only">Mastery by learner and concept, 0 to 100 percent</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-paper px-2 text-left font-semibold">
              Learner
            </th>
            {concepts.map((concept) => (
              <th key={concept.id} scope="col" className="h-28 min-w-10 align-bottom font-medium">
                <span className="inline-block max-w-28 origin-bottom-left translate-x-4 -rotate-45 truncate whitespace-nowrap" title={concept.name}>
                  {concept.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.learner}>
              <th scope="row" className="sticky left-0 whitespace-nowrap bg-paper px-2 text-left font-medium">
                {row.learner}
              </th>
              {row.values.map((value, index) => (
                <td
                  key={concepts[index].id}
                  tabIndex={0}
                  title={`${row.learner} / ${concepts[index].name}: ${value === null ? "not started" : `${Math.round(value * 100)}%`}`}
                  className={cx("h-8 min-w-10 rounded-[3px] text-center tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent", cellClass(value))}
                >
                  {value === null ? "·" : Math.round(value * 100)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink/60" aria-hidden="true">
        Mastery:
        {[0.1, 0.3, 0.5, 0.7, 0.9].map((value) => (
          <span key={value} className={cx("inline-block rounded-[3px] px-2 py-0.5", cellClass(value))}>
            {value === 0.1 ? "<20" : value === 0.9 ? "80+" : `${Math.round((value - 0.1) * 100)}+`}
          </span>
        ))}
        <span>· not started</span>
      </p>
    </div>
  );
}

export function Funnel({ stages }: { stages: Array<{ stage: string; count: number }> }) {
  const top = Math.max(1, stages[0]?.count ?? 1);
  return (
    <ol className="space-y-2" aria-label="Engagement funnel">
      {stages.map((stage, index) => {
        const rate = index === 0 ? 1 : stage.count / top;
        return (
          <li key={stage.stage} tabIndex={0} title={`${stage.stage}: ${stage.count} learners (${Math.round(rate * 100)}% of starters)`} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <span className="text-ink/80">{stage.stage}</span>
            <span className="h-6 bg-ink/[0.06]">
              <span className="block h-full rounded-r-[4px] bg-accent/80" style={{ width: `${Math.max(stage.count ? 2 : 0, rate * 100)}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums">
              {stage.count} <span className="font-normal text-ink/55">({Math.round(rate * 100)}%)</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Pre vs post comparison as two labeled bars on one axis (0 to 100%). */
export function PrePost({ pre, post }: { pre: number; post: number }) {
  const rows = [
    { label: "First evidence", value: pre },
    { label: "Latest estimate", value: post },
  ];
  return <BarList rows={rows} max={1} label="Mastery before and after" format={(value) => `${Math.round(value * 100)}%`} />;
}
