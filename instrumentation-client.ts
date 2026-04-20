// This file configures the initialization of Sentry on the browser.
// The config you add here will be used whenever a page is visited.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust in production — 0.1 (10%) is a sensible starting point.
  // Keep at 1.0 in development so you see every trace.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Only enable in production to avoid noise during development.
  enabled: process.env.NODE_ENV === "production",

  // Scrub sensitive data before sending to Sentry.
  beforeSend(event) {
    // Redact any email addresses in error messages
    if (event.message) {
      event.message = event.message.replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        "[email-redacted]",
      );
    }
    return event;
  },

  // Don't send personally identifiable information by default.
  sendDefaultPii: false,
});

// Required for Next.js 15+ router transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
