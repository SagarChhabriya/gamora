/**
 * Ways to see one lesson. The model only fills in plain data (labels, numbers, lists) and names the
 * view it thinks fits best; the browser draws every view itself, so source text never becomes markup.
 * A view is offered only when the lesson carries the data it needs.
 */

export const viewIds = [
  "notes",
  "flow",
  "key_figure",
  "side_by_side",
  "sequence",
  "trend_bars",
  "share_split",
  "loop",
  "guardrails",
  "checkpoints",
  "milestones",
  "overlap",
  "quadrant",
  "cause_chain",
  "branch_tree",
] as const;
export type ViewId = (typeof viewIds)[number];

export const viewLabels: Record<ViewId, string> = {
  notes: "Notes",
  flow: "Flow",
  key_figure: "Key figure",
  side_by_side: "Side by side",
  sequence: "Sequence",
  trend_bars: "Trend bars",
  share_split: "Share split",
  loop: "Loop",
  guardrails: "Guardrails",
  checkpoints: "Checkpoints",
  milestones: "Milestones",
  overlap: "Overlap",
  quadrant: "Quadrant",
  cause_chain: "Cause chain",
  branch_tree: "Branch tree",
};

export type Figure = { label: string; value: number; unit: string };
export type Column = { label: string; points: string[] };
export type Level = "low" | "high";

export type LessonVisual = {
  figures?: Figure[];
  compare?: { left: Column; right: Column };
  overlap?: { a: Column; b: Column; shared: string[] };
  quadrant?: { x: { low: string; high: string }; y: { low: string; high: string }; cells: Array<{ label: string; x: Level; y: Level }> };
  guard?: { risk: string; protections: string[] };
  cycle?: boolean;
  timeline?: Array<{ when: string; what: string }>;
  chain?: string[];
  best?: ViewId;
};

/** The parts of a lesson the views draw from. */
export type ViewSource = { key_idea: string; notes: string[]; flow: string[]; visual?: LessonVisual };

function sameUnit(figures: Figure[]) {
  return figures.every((figure) => figure.unit === figures[0].unit);
}

/** True when the figures read as parts of one whole: percentages that add up to about 100. */
export function isShareOfWhole(figures: Figure[]) {
  if (figures.length < 2 || !figures.every((figure) => figure.unit === "%" && figure.value > 0)) return false;
  const total = figures.reduce((sum, figure) => sum + figure.value, 0);
  return total >= 95 && total <= 105;
}

/** Every view this lesson has the data for, in a stable order. Notes and flow come first, as before. */
export function availableViews(source: ViewSource): ViewId[] {
  const visual = source.visual ?? {};
  const figures = visual.figures ?? [];
  const has: Record<ViewId, boolean> = {
    notes: source.notes.length > 0,
    flow: source.flow.length >= 3,
    key_figure: figures.length >= 1,
    side_by_side: Boolean(visual.compare && visual.compare.left.points.length && visual.compare.right.points.length),
    sequence: source.flow.length >= 3,
    trend_bars: figures.length >= 2 && sameUnit(figures) && !isShareOfWhole(figures),
    share_split: isShareOfWhole(figures),
    loop: Boolean(visual.cycle) && source.flow.length >= 3,
    guardrails: Boolean(visual.guard && visual.guard.protections.length),
    checkpoints: source.notes.length >= 2,
    milestones: (visual.timeline?.length ?? 0) >= 2,
    overlap: Boolean(visual.overlap && visual.overlap.shared.length && (visual.overlap.a.points.length || visual.overlap.b.points.length)),
    quadrant: (visual.quadrant?.cells.length ?? 0) >= 3,
    cause_chain: (visual.chain?.length ?? 0) >= 3,
    branch_tree: source.notes.length >= 2,
  };
  return viewIds.filter((id) => has[id]);
}

/** The model's pick when it has the data, else the flow for a process, else the notes. */
export function defaultView(source: ViewSource): ViewId {
  const views = availableViews(source);
  const best = source.visual?.best;
  if (best && views.includes(best)) return best;
  if (views.includes("flow")) return "flow";
  return views[0] ?? "notes";
}

function list(items: string[]) {
  return items.filter(Boolean).join("; ");
}

function figureText(figure: Figure) {
  return `${figure.label} ${figure.value}${figure.unit === "%" ? "%" : figure.unit ? ` ${figure.unit}` : ""}`;
}

/** What a screen reader hears instead of the drawing. It says the same thing the picture shows. */
export function describeView(view: ViewId, source: ViewSource): string {
  const visual = source.visual ?? {};
  switch (view) {
    case "notes":
    case "checkpoints":
      return `${source.key_idea}. Points: ${list(source.notes)}.`;
    case "branch_tree":
      return `${source.key_idea}, branching into: ${list(source.notes)}.`;
    case "flow":
    case "sequence":
      return `In order: ${source.flow.map((step, index) => `${index + 1}. ${step}`).join(" ")}`;
    case "loop":
      return `A repeating cycle: ${source.flow.join(", then ")}, and back to ${source.flow[0]}.`;
    case "key_figure":
    case "trend_bars":
    case "share_split":
      return `${view === "share_split" ? "Parts of the whole" : "Figures from the source"}: ${list((visual.figures ?? []).map(figureText))}.`;
    case "side_by_side":
      return visual.compare
        ? `${visual.compare.left.label}: ${list(visual.compare.left.points)}. Compared with ${visual.compare.right.label}: ${list(visual.compare.right.points)}.`
        : "";
    case "overlap":
      return visual.overlap
        ? `Only ${visual.overlap.a.label}: ${list(visual.overlap.a.points)}. Both: ${list(visual.overlap.shared)}. Only ${visual.overlap.b.label}: ${list(visual.overlap.b.points)}.`
        : "";
    case "quadrant":
      return visual.quadrant
        ? `Sorted by ${visual.quadrant.x.low} to ${visual.quadrant.x.high}, and ${visual.quadrant.y.low} to ${visual.quadrant.y.high}: ${list(
            visual.quadrant.cells.map((cell) => `${cell.label} (${visual.quadrant?.x[cell.x]}, ${visual.quadrant?.y[cell.y]})`),
          )}.`
        : "";
    case "guardrails":
      return visual.guard ? `Risk: ${visual.guard.risk}. Protected by: ${list(visual.guard.protections)}.` : "";
    case "milestones":
      return `Milestones: ${list((visual.timeline ?? []).map((item) => `${item.when}, ${item.what}`))}.`;
    case "cause_chain":
      return `Cause and effect: ${(visual.chain ?? []).join(", which leads to ")}.`;
  }
}

/** Statements the extra views make, phrased for the grounding verifier. Numbers are checked separately. */
export function visualClaims(visual: LessonVisual | undefined): string[] {
  if (!visual) return [];
  const claims: string[] = [];
  if (visual.compare) claims.push(`${visual.compare.left.label}: ${list(visual.compare.left.points)}. ${visual.compare.right.label}: ${list(visual.compare.right.points)}.`);
  if (visual.overlap) claims.push(`${visual.overlap.a.label} and ${visual.overlap.b.label} both: ${list(visual.overlap.shared)}.`);
  if (visual.guard) claims.push(`${visual.guard.risk} is protected against by: ${list(visual.guard.protections)}.`);
  if (visual.chain && visual.chain.length >= 3) claims.push(visual.chain.join(" leads to "));
  if (visual.quadrant) claims.push(describeView("quadrant", { key_idea: "", notes: [], flow: [], visual }));
  return claims;
}

/** Plain digits of a number as they might be written in a source: 1,250 and 1250 both match 1250. */
function numberPattern(value: number) {
  const plain = String(value);
  const [whole, fraction] = plain.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",?");
  return new RegExp(`(?<![\\d.,])${grouped}${fraction ? `\\.${fraction}` : ""}(?![\\d])`);
}

/** True when the source text states this number. */
export function sourceStates(value: number, sourceText: string) {
  return Number.isFinite(value) && numberPattern(value).test(sourceText);
}

/**
 * Removes anything numeric the source does not state, so a diagram never shows an invented figure.
 * A dated milestone must carry a date that appears in the source; a figure must carry its number.
 */
export function groundVisual(visual: LessonVisual | undefined, sourceText: string): LessonVisual | undefined {
  if (!visual) return undefined;
  const figures = (visual.figures ?? []).filter((figure) => sourceStates(figure.value, sourceText)).slice(0, 6);
  const timeline = (visual.timeline ?? []).filter((item) => {
    const numbers = item.when.match(/\d+(?:\.\d+)?/g) ?? [];
    return numbers.every((number) => sourceStates(Number(number), sourceText));
  });
  return { ...visual, figures, timeline };
}
