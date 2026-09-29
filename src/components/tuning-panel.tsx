import { cx } from "@/components/ui";
import type { TuningState } from "@/lib/tutor/engine";

const paceText: Record<string, string> = { brisk: "Brisk", normal: "Steady", gentle: "Gentle" };

function support(state: TuningState) {
  if (state.worked_example) return "Worked example first";
  return state.modality === "choices" ? "Guided choices" : "Open questions";
}

/**
 * Tuning: what the adaptation rules are using right now, shown all the time rather than only when
 * something changes. The "Why this changed" notes in the conversation explain each change.
 */
export function TuningPanel({ state, focus, className }: { state: TuningState | null; focus?: string | null; className?: string }) {
  return (
    <div className={cx("border border-ink/15 bg-panel p-4", className)} data-tour="tuning">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">Tuning</p>
        <p className="text-[11px] text-ink/50">measured from your answers</p>
      </div>
      {state ? (
        <>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink/60">Challenge</dt>
              <dd className="flex items-center gap-1" aria-label={`Level ${state.difficulty} of 5`}>
                {[1, 2, 3, 4, 5].map((dot) => (
                  <span key={dot} aria-hidden="true" className={cx("h-3 w-3 rounded-full border", dot <= state.difficulty ? "border-accent bg-accent" : "border-ink/30 bg-paper")} />
                ))}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink/60">Support</dt>
              <dd className="font-semibold">{support(state)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink/60">Pace</dt>
              <dd className="font-semibold">{paceText[state.pace] ?? state.pace}</dd>
            </div>
            {focus ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-ink/60">Working on</dt>
                <dd className="text-right font-semibold">{focus}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-3 border-t border-ink/10 pt-2 text-xs leading-5 text-ink/60">
            {state.evidence_count < 2
              ? "Not enough answers yet, so your starting settings apply."
              : `Based on your last ${Math.min(state.evidence_count, 12)} answers.`}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink/60">Loading...</p>
      )}
    </div>
  );
}
