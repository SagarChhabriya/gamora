"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort boundary for errors in the root layout itself. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, sans-serif", background: "#f7f0e6", color: "#173b36", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 16 }}>
          <h1 style={{ fontSize: 28 }}>Gamora hit a problem.</h1>
          <p>Your progress is saved. Please try again.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 20px", background: "#173b36", color: "#f7f0e6", border: 0, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
