import * as Sentry from "@sentry/nextjs";

/**
 * Reports a handled error to Sentry with the request ID and hashed user, so an error in the
 * dashboard can be traced to the matching rows in the events table.
 */
export function reportError(error: unknown, context: { requestId: string; userHash?: string; area: string; extra?: Record<string, unknown> }) {
  Sentry.withScope((scope) => {
    scope.setTag("area", context.area);
    scope.setTag("request_id", context.requestId);
    if (context.userHash) scope.setUser({ id: context.userHash });
    if (context.extra) scope.setContext("details", context.extra);
    Sentry.captureException(error);
  });
}
