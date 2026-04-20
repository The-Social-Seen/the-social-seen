"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

/**
 * PostHog provider that initialises the client SDK and tracks pageviews
 * on every route change. Only runs in the browser.
 *
 * Config:
 *   - `capture_pageview: false` because we manually capture on route changes
 *     (Next.js App Router doesn't fire full page reloads).
 *   - `capture_pageleave: true` to measure time-on-page.
 *   - `person_profiles: "identified_only"` — no profile created until we call
 *     `posthog.identify()` after login. Keeps anonymous events cheap.
 */

function initPostHog() {
  if (typeof window === "undefined") return;
  if (posthog.__loaded) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!key || !host) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[PostHog] NEXT_PUBLIC_POSTHOG_KEY or _HOST missing — analytics disabled.");
    }
    return;
  }

  posthog.init(key, {
    api_host: host,
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
    // Respect do-not-track browser setting
    respect_dnt: true,
  });
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || typeof window === "undefined") return;
    if (!posthog.__loaded) return;

    const url =
      window.location.origin +
      pathname +
      (searchParams?.toString() ? `?${searchParams.toString()}` : "");

    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  return (
    <PHProvider client={posthog}>
      <PageviewTracker />
      {children}
    </PHProvider>
  );
}
