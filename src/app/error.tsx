"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

/** Any page that throws shows a way back instead of a blank screen, and the error goes to Sentry. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 text-ink">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Something went wrong</p>
        <h1 className="text-3xl font-semibold">This page hit a problem.</h1>
        <p className="text-ink/70">Your progress is saved. Try again, or go back to your journeys.</p>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={reset} className="min-h-11 bg-ink px-5 text-sm font-semibold text-paper hover:bg-accent">
            Try again
          </button>
          <Link href="/" className="inline-flex min-h-11 items-center border border-ink/25 px-5 text-sm font-semibold">
            My journeys
          </Link>
        </div>
        {error.digest ? <p className="text-xs text-ink/50">Reference: {error.digest}</p> : null}
      </div>
    </main>
  );
}
