import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/components/ui";
import type { MissionView } from "@/lib/journey/load";

/**
 * Missions as one winding path. The trail snakes between the cards, which sit on alternate sides on
 * wide screens and to the right of the trail on phones. Each row draws its own stretch of trail from
 * the row edge to its stop and back, so cards of any height still join up. The trail is solid up to
 * the furthest stop reached and dashed beyond it.
 */
export function MissionPath({ missions, journeyId, renderCard }: { missions: MissionView[]; journeyId: string; renderCard: (mission: MissionView) => ReactNode }) {
  return (
    <ol className="relative">
      {missions.map((mission, index) => {
        const locked = mission.status === "locked";
        const left = index % 2 === 0;
        // The stop leans toward its card, which makes the trail swing from side to side.
        const x = left ? 26 : 74;
        const reached = !locked;
        const passed = mission.status === "completed";
        const first = index === 0;
        const last = index === missions.length - 1;
        const card = renderCard(mission);
        return (
          <li key={mission.id} className="grid grid-cols-[56px_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
            <div aria-hidden="true" className="relative col-start-1 row-start-1 md:col-start-2">
              <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                {first ? null : (
                  <path
                    d={`M 50 0 C 50 22, ${x} 28, ${x} 50`}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={4}
                    strokeLinecap="round"
                    className={reached ? "stroke-good" : "stroke-ink/20"}
                    strokeDasharray={reached ? undefined : "2 8"}
                  />
                )}
                {last ? null : (
                  <path
                    d={`M ${x} 50 C ${x} 72, 50 78, 50 100`}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={4}
                    strokeLinecap="round"
                    className={passed ? "stroke-good" : "stroke-ink/20"}
                    strokeDasharray={passed ? undefined : "2 8"}
                  />
                )}
              </svg>
              <span
                className={cx(
                  "absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] text-sm font-bold",
                  passed ? "border-good bg-good text-paper" : locked ? "border-ink/20 bg-paper text-ink/45" : "border-accent bg-paper text-accent",
                  mission.status === "in_progress" && "ring-4 ring-accent/25",
                )}
                style={{ left: `${x}%` }}
              >
                {passed ? "✓" : locked ? "🔒" : index + 1}
              </span>
            </div>
            <div className={cx("col-start-2 row-start-1 py-3", left ? "md:col-start-1" : "md:col-start-3")}>
              {locked ? (
                <div aria-disabled="true">{card}</div>
              ) : (
                <Link href={`/journey/${journeyId}/mission/${mission.id}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  {card}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
