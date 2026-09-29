"use client";

import { Fragment, useId, useState, type ReactNode } from "react";

import { cx } from "@/components/ui";
import { availableViews, defaultView, describeView, isShareOfWhole, viewLabels, type Figure, type ViewId, type ViewSource } from "@/lib/visuals/views";

/**
 * Categorical colours for diagrams, in fixed order. Checked with the palette validator against the
 * cream and the high-contrast white surfaces: every adjacent pair stays apart for colour-blind
 * readers, and every mark keeps 3:1 contrast. Marks always carry a direct text label as well.
 */
export const SERIES = ["#c2502f", "#3a6ea5", "#3f8a5a", "#7a4f8c", "#b07a1f"] as const;
const series = (index: number) => SERIES[index % SERIES.length];

function formatValue(figure: Figure) {
  const value = figure.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (figure.unit === "%") return `${value}%`;
  return figure.unit ? `${value} ${figure.unit}` : value;
}

function Arrow({ className }: { className?: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ the two views that already existed */

export function StickyNotes({ notes }: { notes: string[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {notes.map((note, index) => (
        <li
          key={note}
          className={cx(
            "sticky-note min-h-20 p-4 text-sm font-medium leading-6 shadow-[2px_3px_0_rgb(23_59_54/0.12)]",
            `sticky-note-${(index % 4) + 1}`,
            index % 2 ? "sm:rotate-[0.8deg]" : "sm:-rotate-[0.8deg]",
          )}
        >
          {note}
        </li>
      ))}
    </ul>
  );
}

export function FlowDiagram({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center">
      {steps.map((step, index) => (
        <Fragment key={step}>
          <li className="flex flex-1 items-center gap-2 border border-ink/25 bg-paper px-3 py-2.5 text-sm font-medium">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold text-paper">{index + 1}</span>
            {step}
          </li>
          {index < steps.length - 1 ? (
            <li aria-hidden="true" className="flex justify-center text-accent">
              <Arrow className="rotate-90 sm:rotate-0" />
            </li>
          ) : null}
        </Fragment>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ new views */

function KeyFigure({ figures }: { figures: Figure[] }) {
  const [lead, ...rest] = figures;
  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="border-l-4 border-accent bg-paper px-5 py-4">
        <p className="text-5xl font-semibold tracking-[-0.04em] tabular-nums">{formatValue(lead)}</p>
        <p className="mt-1 text-sm font-medium text-ink/70">{lead.label}</p>
      </div>
      {rest.length ? (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {rest.slice(0, 4).map((figure) => (
            <div key={figure.label} className="border border-ink/15 bg-paper px-3 py-2">
              <dt className="text-ink/65">{figure.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatValue(figure)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function SideBySide({ left, right }: { left: { label: string; points: string[] }; right: { label: string; points: string[] } }) {
  const column = (item: { label: string; points: string[] }, color: string) => (
    <div className="border border-ink/20 bg-paper">
      <p className="px-4 py-2 text-sm font-semibold text-paper" style={{ background: color }}>
        {item.label}
      </p>
      <ul className="space-y-2 p-4 text-sm leading-6">
        {item.points.map((point) => (
          <li key={point} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="relative grid gap-3 sm:grid-cols-2 sm:gap-8">
      {column(left, series(0))}
      <span aria-hidden="true" className="mx-auto grid h-9 w-9 place-items-center rounded-full border-2 border-ink bg-panel text-xs font-bold sm:absolute sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2">
        vs
      </span>
      {column(right, series(1))}
    </div>
  );
}

function Sequence({ steps }: { steps: string[] }) {
  return (
    <ol className="relative space-y-3 pl-2">
      <span aria-hidden="true" className="absolute bottom-4 left-[1.45rem] top-4 w-0.5 bg-ink/20" />
      {steps.map((step, index) => (
        <li key={step} className="relative flex items-center gap-3">
          <span className="z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-paper bg-accent text-sm font-semibold text-paper">{index + 1}</span>
          <span className="flex-1 border border-ink/15 bg-paper px-3 py-2 text-sm font-medium">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** Column chart: one series, so no legend; values sit on the bars and labels under them. */
function TrendBars({ figures }: { figures: Figure[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...figures.map((figure) => figure.value), 0) || 1;
  const width = 100 / figures.length;
  return (
    <div>
      <svg viewBox="0 0 320 170" className="h-auto w-full max-w-lg" aria-hidden="true">
        <line x1="0" y1="140" x2="320" y2="140" stroke="currentColor" strokeOpacity="0.25" />
        {figures.map((figure, index) => {
          const h = Math.max(2, (Math.max(0, figure.value) / max) * 112);
          const bw = Math.min(46, (320 * width) / 100 - 14);
          const x = (index + 0.5) * ((320 * width) / 100) - bw / 2;
          return (
            <g key={figure.label} onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)}>
              <rect x={x - 6} y="10" width={bw + 12} height="140" fill="transparent" />
              <path d={`M${x} 140 V${140 - h + 4} q0 -4 4 -4 H${x + bw - 4} q4 0 4 4 V140 Z`} fill={series(0)} opacity={hover === null || hover === index ? 1 : 0.45} />
              <text x={x + bw / 2} y={132 - h} textAnchor="middle" className="fill-current text-[11px] font-semibold">
                {formatValue(figure)}
              </text>
              <text x={x + bw / 2} y="158" textAnchor="middle" className="fill-current text-[10px] opacity-70">
                {figure.label.length > 14 ? `${figure.label.slice(0, 13)}…` : figure.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="min-h-5 text-xs text-ink/65" aria-live="polite">
        {hover !== null ? `${figures[hover].label}: ${formatValue(figures[hover])}` : "Point at a bar for its full label."}
      </p>
    </div>
  );
}

/** Donut of parts of a whole, with a 2px gap between parts and every part labelled beside it. */
function ShareSplit({ figures }: { figures: Figure[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = figures.reduce((sum, figure) => sum + figure.value, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const lengths = figures.map((figure) => (figure.value / total) * circumference);
  const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, value) => sum + value, 0));
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[180px_1fr]">
      <svg viewBox="0 0 160 160" className="mx-auto h-40 w-40" aria-hidden="true">
        <g transform="rotate(-90 80 80)">
          {figures.map((figure, index) => {
            const length = lengths[index];
            const dash = `${Math.max(0, length - 2)} ${circumference}`;
            const node = (
              <circle
                key={figure.label}
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke={series(index)}
                strokeWidth={hover === index ? 26 : 22}
                strokeDasharray={dash}
                strokeDashoffset={-starts[index]}
                onPointerEnter={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
              />
            );
            return node;
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" className="fill-current text-[20px] font-semibold">
          {hover !== null ? formatValue(figures[hover]) : "100%"}
        </text>
        <text x="80" y="96" textAnchor="middle" className="fill-current text-[10px] opacity-70">
          {hover !== null ? figures[hover].label.slice(0, 18) : "of the whole"}
        </text>
      </svg>
      <ul className="space-y-2 text-sm">
        {figures.map((figure, index) => (
          <li key={figure.label} className="flex items-center justify-between gap-3 border-b border-ink/10 pb-2" onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)}>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ background: series(index) }} />
              {figure.label}
            </span>
            <span className="font-semibold tabular-nums">{formatValue(figure)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Steps placed around a ring, with arrows on the ring showing it repeats. */
function Loop({ steps }: { steps: string[] }) {
  const count = steps.length;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm">
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full text-accent" aria-hidden="true">
        <circle cx="100" cy="100" r="62" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="4 5" />
        {steps.map((_, index) => {
          const angle = ((index + 0.5) / count) * 2 * Math.PI - Math.PI / 2;
          const x = 100 + 62 * Math.cos(angle);
          const y = 100 + 62 * Math.sin(angle);
          const deg = (angle * 180) / Math.PI + 90;
          return <path key={index} d="M-5 -4 L4 0 L-5 4 Z" fill="currentColor" transform={`translate(${x} ${y}) rotate(${deg})`} />;
        })}
        <text x="100" y="104" textAnchor="middle" className="fill-current text-[11px] font-semibold">
          repeats
        </text>
      </svg>
      {steps.map((step, index) => {
        const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
        return (
          <div
            key={step}
            className="absolute w-[36%] -translate-x-1/2 -translate-y-1/2 border border-ink/25 bg-paper px-2 py-1.5 text-center text-xs font-medium leading-4 shadow-sm"
            style={{ left: `${50 + 32 * Math.cos(angle)}%`, top: `${50 + 34 * Math.sin(angle)}%` }}
          >
            <span className="mr-1 font-semibold text-accent">{index + 1}</span>
            {step}
          </div>
        );
      })}
    </div>
  );
}

function Guardrails({ risk, protections }: { risk: string; protections: string[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 border-2 border-danger bg-danger-soft px-4 py-3">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-danger" aria-hidden="true">
          <path d="M12 3 2 20h20L12 3z" />
          <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
        </svg>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-danger">Risk</p>
          <p className="font-semibold">{risk}</p>
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/60">Protected by</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {protections.map((item) => (
          <li key={item} className="flex items-start gap-2 border border-good/50 bg-paper px-3 py-2 text-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-good" aria-hidden="true">
              <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />
              <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A checklist the learner can tick while reading. Ticks are not saved or scored. */
function Checkpoints({ items }: { items: string[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const id = useId();
  return (
    <div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={item}>
            <label htmlFor={`${id}-${index}`} className={cx("flex cursor-pointer items-start gap-3 border px-3 py-2.5 text-sm", done.has(index) ? "border-good bg-good/10" : "border-ink/20 bg-paper")}>
              <input
                id={`${id}-${index}`}
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--good)]"
                checked={done.has(index)}
                onChange={() =>
                  setDone((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
              />
              <span className={cx(done.has(index) && "text-ink/70")}>{item}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink/60">
        {done.size} of {items.length} checked. Tick each one you could explain to someone.
      </p>
    </div>
  );
}

function Milestones({ items }: { items: Array<{ when: string; what: string }> }) {
  return (
    <ol className="relative grid gap-4 border-l-2 border-ink/20 pl-5 sm:grid-flow-col sm:border-l-0 sm:border-t-2 sm:pl-0 sm:pt-5" style={{ gridAutoColumns: "1fr" }}>
      {items.map((item) => (
        <li key={`${item.when}-${item.what}`} className="relative">
          <span aria-hidden="true" className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-paper bg-accent sm:-top-[27px] sm:left-0" />
          <p className="text-sm font-semibold text-accent">{item.when}</p>
          <p className="text-sm leading-6">{item.what}</p>
        </li>
      ))}
    </ol>
  );
}

function Overlap({ a, b, shared }: { a: { label: string; points: string[] }; b: { label: string; points: string[] }; shared: string[] }) {
  const column = (title: string, points: string[], color: string) => (
    <div className="border-t-4 bg-paper p-3" style={{ borderColor: color }}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/70">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm leading-5">
        {points.length ? points.map((point) => <li key={point}>{point}</li>) : <li className="text-ink/50">Nothing listed</li>}
      </ul>
    </div>
  );
  return (
    <div className="space-y-3">
      <svg viewBox="0 0 240 120" className="mx-auto h-28 w-auto" aria-hidden="true">
        <circle cx="92" cy="60" r="50" fill={series(0)} fillOpacity="0.18" stroke={series(0)} strokeWidth="2" />
        <circle cx="148" cy="60" r="50" fill={series(1)} fillOpacity="0.18" stroke={series(1)} strokeWidth="2" />
        <text x="66" y="64" textAnchor="middle" className="fill-current text-[11px] font-semibold">
          {a.label.slice(0, 12)}
        </text>
        <text x="174" y="64" textAnchor="middle" className="fill-current text-[11px] font-semibold">
          {b.label.slice(0, 12)}
        </text>
        <text x="120" y="64" textAnchor="middle" className="fill-current text-[11px] font-semibold">
          Both
        </text>
      </svg>
      <div className="grid gap-2 sm:grid-cols-3">
        {column(`Only ${a.label}`, a.points, series(0))}
        {column("Both", shared, series(2))}
        {column(`Only ${b.label}`, b.points, series(1))}
      </div>
    </div>
  );
}

function Quadrant({ quadrant }: { quadrant: NonNullable<NonNullable<ViewSource["visual"]>["quadrant"]> }) {
  const cell = (x: "low" | "high", y: "low" | "high") => quadrant.cells.filter((item) => item.x === x && item.y === y);
  const box = (x: "low" | "high", y: "low" | "high", tint: number) => (
    <div className="min-h-24 border border-ink/15 p-2" style={{ background: `color-mix(in srgb, ${series(tint)} 10%, var(--background))` }}>
      <ul className="space-y-1 text-sm">
        {cell(x, y).map((item) => (
          <li key={item.label} className="border border-ink/15 bg-paper px-2 py-1 font-medium">
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <div className="flex flex-col items-center justify-between pb-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/60">
        <span className="rotate-180 [writing-mode:vertical-rl]">{quadrant.y.high}</span>
        <span aria-hidden="true">↑</span>
        <span className="rotate-180 [writing-mode:vertical-rl]">{quadrant.y.low}</span>
      </div>
      <div>
        <div className="grid grid-cols-2 gap-1">
          {box("low", "high", 1)}
          {box("high", "high", 2)}
          {box("low", "low", 4)}
          {box("high", "low", 0)}
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/60">
          <span>{quadrant.x.low}</span>
          <span aria-hidden="true">→</span>
          <span>{quadrant.x.high}</span>
        </div>
      </div>
    </div>
  );
}

function CauseChain({ links }: { links: string[] }) {
  return (
    <ol className="flex flex-col gap-1 sm:flex-row sm:items-stretch">
      {links.map((link, index) => {
        const last = index === links.length - 1;
        return (
          <Fragment key={link}>
            <li className={cx("flex-1 px-3 py-3 text-sm", last ? "border-2 border-accent bg-paper font-semibold" : "border border-ink/20 bg-paper")}>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/55">{index === 0 ? "Cause" : last ? "Outcome" : "Effect"}</span>
              {link}
            </li>
            {!last ? (
              <li aria-hidden="true" className="flex items-center justify-center gap-1 text-[11px] font-semibold text-accent sm:flex-col">
                <Arrow className="rotate-90 sm:rotate-0" />
                <span>leads to</span>
              </li>
            ) : null}
          </Fragment>
        );
      })}
    </ol>
  );
}

function BranchTree({ root, leaves }: { root: string; leaves: string[] }) {
  return (
    <div className="flex flex-col items-center">
      <p className="line-clamp-4 max-w-md border-2 border-ink bg-paper px-4 py-2 text-center text-sm font-semibold">{root}</p>
      <span aria-hidden="true" className="h-4 w-0.5 bg-ink/30" />
      <ul className="grid w-full gap-3 border-t-2 border-ink/30 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        {leaves.map((leaf, index) => (
          <li key={leaf} className="relative border bg-paper px-3 py-2 text-sm" style={{ borderColor: series(index) }}>
            <span aria-hidden="true" className="absolute -top-4 left-1/2 h-4 w-0.5 bg-ink/30" />
            {leaf}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Draws one view of a lesson. Unknown or unsupported views fall back to the notes. */
export function Diagram({ view, source }: { view: ViewId; source: ViewSource }) {
  const visual = source.visual ?? {};
  const figures = visual.figures ?? [];
  let body: ReactNode;
  switch (view) {
    case "flow":
      body = <FlowDiagram steps={source.flow} />;
      break;
    case "key_figure":
      body = figures.length ? <KeyFigure figures={figures} /> : null;
      break;
    case "side_by_side":
      body = visual.compare ? <SideBySide left={visual.compare.left} right={visual.compare.right} /> : null;
      break;
    case "sequence":
      body = <Sequence steps={source.flow} />;
      break;
    case "trend_bars":
      body = figures.length >= 2 ? <TrendBars figures={figures} /> : null;
      break;
    case "share_split":
      body = isShareOfWhole(figures) ? <ShareSplit figures={figures} /> : null;
      break;
    case "loop":
      body = <Loop steps={source.flow} />;
      break;
    case "guardrails":
      body = visual.guard ? <Guardrails risk={visual.guard.risk} protections={visual.guard.protections} /> : null;
      break;
    case "checkpoints":
      body = <Checkpoints items={source.notes} />;
      break;
    case "milestones":
      body = visual.timeline?.length ? <Milestones items={visual.timeline} /> : null;
      break;
    case "overlap":
      body = visual.overlap ? <Overlap a={visual.overlap.a} b={visual.overlap.b} shared={visual.overlap.shared} /> : null;
      break;
    case "quadrant":
      body = visual.quadrant ? <Quadrant quadrant={visual.quadrant} /> : null;
      break;
    case "cause_chain":
      body = visual.chain?.length ? <CauseChain links={visual.chain} /> : null;
      break;
    case "branch_tree":
      body = <BranchTree root={source.key_idea} leaves={source.notes} />;
      break;
    default:
      body = null;
  }
  const shown = body ? view : "notes";
  return (
    <figure>
      <figcaption className="sr-only">{describeView(shown, source)}</figcaption>
      <div aria-hidden={shown === "checkpoints" ? undefined : "true"}>{body ?? <StickyNotes notes={source.notes} />}</div>
    </figure>
  );
}

/** "View as": the learner can flip one lesson between every view its data supports. */
export function LessonViews({ source, label = "View as" }: { source: ViewSource; label?: string }) {
  const views = availableViews(source);
  const [view, setView] = useState<ViewId>(() => defaultView(source));
  if (!views.length) return null;
  const current = views.includes(view) ? view : views[0];
  return (
    <div className="space-y-3">
      {views.length > 1 ? (
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={`${label}, ${views.length} ways to see this`}>
          <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">{label}</span>
          {views.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={current === id}
              onClick={() => setView(id)}
              className={cx(
                "min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold",
                current === id ? "border-ink bg-ink text-paper" : "border-ink/25 bg-paper text-ink/75 hover:border-accent hover:text-accent",
              )}
            >
              {viewLabels[id]}
            </button>
          ))}
        </div>
      ) : null}
      <Diagram view={current} source={source} />
    </div>
  );
}
