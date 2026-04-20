// This file configures the initialization of Sentry for edge runtimes
// (e.g. middleware, edge API routes).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Only enable in production to avoid noise during development.
  enabled: process.env.NODE_ENV === "production",

  sendDefaultPii: false,
});
