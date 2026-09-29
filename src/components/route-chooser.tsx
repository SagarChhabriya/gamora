"use client";

import { useState } from "react";

import { Button, cx } from "@/components/ui";
import { learningRoutes, routeInfo, type LearningRoute } from "@/lib/config/schema";

const paths: Record<LearningRoute, string> = {
  narrative: "M4 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-4a2 2 0 0 0-2 2",
  scenarios: "M6 3v6a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4M18 3v4M6 21v-8",
  quick_scan: "M4 6l6 6-6 6M12 6l6 6-6 6",
  focus: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
};

function RouteIcon({ route }: { route: LearningRoute }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[route]} />
    </svg>
  );
}

/** Four learning routes as cards. The learner picks one, then builds the journey. */
export function RouteChooser({ busy, onChoose, onCancel }: { busy: boolean; onChoose: (route: LearningRoute) => void; onCancel?: () => void }) {
  const [route, setRoute] = useState<LearningRoute>("narrative");
  return (
    <div className="w-full space-y-3 border-t border-ink/10 pt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">How would you like to go through it?</p>
      <div role="radiogroup" aria-label="Learning route" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {learningRoutes.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={route === id}
            onClick={() => setRoute(id)}
            className={cx(
              "flex min-h-24 flex-col items-start gap-1 border p-3 text-left transition",
              route === id ? "border-accent bg-paper ring-2 ring-accent/25" : "border-ink/20 bg-paper hover:border-accent",
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              <span aria-hidden="true" className={cx("grid h-7 w-7 place-items-center rounded-full text-sm", route === id ? "bg-accent text-paper" : "bg-ink/10")}>
                <RouteIcon route={id} />
              </span>
              {routeInfo[id].label}
            </span>
            <span className="text-xs leading-5 text-ink/65">{routeInfo[id].description}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onChoose(route)} disabled={busy}>
          {busy ? "Planning your journey..." : `Build my ${routeInfo[route].label.toLowerCase()} journey`}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
