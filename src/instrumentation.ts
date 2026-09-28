import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

// Uncaught errors in route handlers and server rendering go to Sentry with the route attached.
export const onRequestError = Sentry.captureRequestError;
