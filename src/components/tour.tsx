"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import { pageOf, tourKey, tourSteps, type TourPage } from "@/lib/tour/steps";

const EVENT = "gamora:tour";
const doneKey = `${tourKey}.done`;

type Saved = { active: boolean; index: number };

function read(): Saved {
  try {
    const saved = JSON.parse(window.localStorage.getItem(tourKey) ?? "null") as Saved | null;
    return saved && typeof saved.index === "number" ? saved : { active: false, index: 0 };
  } catch {
    return { active: false, index: 0 };
  }
}

function write(value: Saved) {
  try {
    window.localStorage.setItem(tourKey, JSON.stringify(value));
  } catch {
    // Storage may be blocked; the tour still runs for this page view.
  }
}

/** Starts the guided tour from the first step. */
export function startTour() {
  write({ active: true, index: 0 });
  window.dispatchEvent(new Event(EVENT));
}

/** Remembers that the learner does not want the tour offered again on this device. */
export function dismissTour() {
  try {
    window.localStorage.setItem(doneKey, "1");
  } catch {
    // Ignore.
  }
}

/** True once the learner has finished or skipped the tour on this device. */
export function tourSeen() {
  try {
    return window.localStorage.getItem(doneKey) === "1";
  } catch {
    return true;
  }
}

function visible(target: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((element) => element.offsetParent !== null || element.getClientRects().length > 0);
}

/** Where a page lives for this learner: the latest journey and its first open mission. */
async function hrefFor(page: TourPage): Promise<string | null> {
  if (page === "home") return "/";
  if (page === "studio") return "/studio";
  if (page === "any") return null;
  const list = await authFetch("/api/journeys").then((response) => (response.ok ? (response.json() as Promise<{ journeys: Array<{ id: string }> }>) : null)).catch(() => null);
  const journey = list?.journeys[0];
  if (!journey) return null;
  if (page === "journey") return `/journey/${journey.id}`;
  const detail = await authFetch(`/api/journeys/${journey.id}`)
    .then((response) => (response.ok ? (response.json() as Promise<{ missions: Array<{ id: string; status: string }> }>) : null))
    .catch(() => null);
  const mission = detail?.missions.find((item) => item.status !== "locked") ?? detail?.missions[0];
  return mission ? `/journey/${journey.id}/mission/${mission.id}` : null;
}

const pageNames: Record<TourPage, string> = { home: "Journeys", studio: "Studio", journey: "journey map", mission: "mission", any: "" };

/**
 * The guided tour overlay. It dims the page, outlines the element a step is about and explains it,
 * moving between pages as the tour goes. It remembers the step, so a page change carries on.
 */
export function Tour() {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<Saved>({ active: false, index: 0 });
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The tour state lives in browser storage, which is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(read());
    const onStart = () => setState(read());
    window.addEventListener(EVENT, onStart);
    return () => window.removeEventListener(EVENT, onStart);
  }, []);

  const step = state.active ? tourSteps[state.index] : null;

  const finish = useCallback(() => {
    write({ active: false, index: 0 });
    try {
      window.localStorage.setItem(doneKey, "1");
    } catch {
      // Ignore.
    }
    setState({ active: false, index: 0 });
    setRect(null);
  }, []);

  // Find the element for this step; wait briefly, since pages load their data after they render.
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    let tries = 0;
    let element: HTMLElement | undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMissing(null);
    setRect(null);
    const onPage = step.page === "any" || step.page === pageOf(pathname);
    const measure = () => element && setRect(element.getBoundingClientRect());
    const look = () => {
      if (cancelled) return;
      element = step.target && onPage ? visible(step.target) : undefined;
      if (element) {
        element.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        window.setTimeout(measure, 350);
        return;
      }
      tries += 1;
      if (onPage && step.target && tries < 16) window.setTimeout(look, 250);
      else if (!onPage) setMissing(step.page);
    };
    look();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, pathname]);

  useEffect(() => {
    if (!step) return;
    card.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, finish]);

  const go = useCallback(
    async (index: number) => {
      if (index >= tourSteps.length) return finish();
      const next = { active: true, index: Math.max(0, index) };
      write(next);
      const target = tourSteps[next.index];
      if (target.page !== "any" && target.page !== pageOf(pathname)) {
        setMoving(true);
        const href = await hrefFor(target.page);
        setMoving(false);
        if (href) {
          setState(next);
          router.push(href);
          return;
        }
      }
      setState(next);
    },
    [finish, pathname, router],
  );

  if (!step) return null;
  const last = state.index === tourSteps.length - 1;
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  const pad = 8;
  const place: React.CSSProperties =
    rect && !narrow
      ? {
          top: rect.bottom + 260 < window.innerHeight ? rect.bottom + pad + 8 : Math.max(16, rect.top - pad - 8 - 250),
          left: Math.min(Math.max(16, rect.left), window.innerWidth - 400),
        }
      : {};

  return (
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed border-2 border-accent transition-all duration-300 motion-reduce:transition-none"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgb(23 59 54 / 0.45)" }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-ink/45" />
      )}
      <div
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-label={`Tour, step ${state.index + 1} of ${tourSteps.length}: ${step.title}`}
        className={
          rect && !narrow
            ? "fixed w-[min(384px,calc(100vw-32px))] border border-ink/20 bg-paper p-5 shadow-xl outline-none"
            : rect
              ? "fixed inset-x-0 bottom-0 border-t border-ink/20 bg-paper p-5 shadow-xl outline-none"
              : "fixed left-1/2 top-1/2 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 border border-ink/20 bg-paper p-6 shadow-xl outline-none"
        }
        style={place}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Tour / {state.index + 1} of {tourSteps.length}
        </p>
        <h2 className="mt-2 text-xl font-semibold">{step.title}</h2>
        <p className="mt-2 text-sm leading-6 text-ink/75">{step.body}</p>
        {missing ? (
          <p className="mt-3 border-l-2 border-accent pl-3 text-xs leading-5 text-ink/65">
            {missing === "journey" || missing === "mission"
              ? `You will see this on the ${pageNames[missing]} once you have built a journey.`
              : `This part is on the ${pageNames[missing as TourPage]} page.`}
          </p>
        ) : null}
        <div className="mt-4 h-1 w-full bg-ink/10">
          <div className="h-full bg-accent" style={{ width: `${((state.index + 1) / tourSteps.length) * 100}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="px-3" disabled={state.index === 0 || moving} onClick={() => void go(state.index - 1)}>
            Back
          </Button>
          <Button className="px-4" disabled={moving} onClick={() => void go(state.index + 1)}>
            {moving ? "Opening..." : last ? "Finish" : "Next"}
          </Button>
          <button type="button" onClick={finish} className="ml-auto min-h-11 px-2 text-sm font-semibold text-ink/60 hover:text-accent">
            Skip tour
          </button>
        </div>
      </div>
    </div>
  );
}
