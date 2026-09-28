import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1,
  // Data minimisation: no cookies, bodies, query strings, or IP-derived user data. Learners appear as a hash only.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ["user-agent", "x-request-id"] }, response: false },
    httpBodies: [],
    urlQueryParams: false,
  },
  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      if (event.request.headers) delete event.request.headers.authorization;
    }
    return event;
  },
});
