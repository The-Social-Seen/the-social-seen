"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PostHog } from "posthog-js";
import { onConsentChange, readConsent } from "@/lib/analytics/consent";
import { setPostHog } from "@/lib/analytics/posthog-instance";

/**
 * PostHog provider that initialises the client SDK and tracks pageviews
 * on every route change. Only runs in the browser.
 *
 * P2-8b: consent-gated — `posthog.init()` fires only when the user has
 * explicitly granted analytics consent via the cookie banner. If they
 * decline, no cookies set, no network calls made. If they toggle from
 * denied → granted later, the consent listener re-initialises without
 * a reload (and revocation opts out).
 *
 * CL-7: bundle-gated as well — `posthog-js` is **dynamically imported**
 * only after consent is granted. Until then the SDK never enters the
 * client bundle for that visitor, shrinking initial JS for the (likely
 * sizeable) decline-cookies cohort. Type-only import keeps the
 * `PostHog` type available without pulling the runtime.
 *
 * Config:
 *   - `capture_pageview: false` because we manually capture on route changes
 *     (Next.js App Router doesn't fire full page reloads).
 *   - `capture_pageleave: true` to measure time-on-page.
 *   - `person_profiles: "identified_only"` — no profile created until we call
 *     `posthog.identify()` after login. Keeps anonymous events cheap.
 */

// Module-level handle so PageviewTracker + consent toggles can reach
// the same client across renders. `null` until first init succeeds.
let posthog: PostHog | null = null;
let initInFlight: Promise<void> | null = null;

async function initPostHog(): Promise<void> {
  if (typeof window === "undefined") return;
  if (posthog?.__loaded) return;
  if (initInFlight) return initInFlight;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!key || !host) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[PostHog] NEXT_PUBLIC_POSTHOG_KEY or _HOST missing — analytics disabled.");
    }
    return;
  }

  initInFlight = (async () => {
    // Dynamic import keeps posthog-js out of the bundle for visitors
    // who never grant analytics consent.
    const mod = await import("posthog-js");
    const ph = mod.default;
    ph.init(key, {
      api_host: host,
      capture_pageview: false,
      capture_pageleave: true,
      person_profiles: "identified_only",
      // Respect do-not-track browser setting
      respect_dnt: true,
    });
    posthog = ph;
    setPostHog(ph);
  })();
  await initInFlight;
  initInFlight = null;
}

function PageviewTracker({ ready }: { ready: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!ready) return;
    if (!pathname || typeof window === "undefined") return;
    if (!posthog?.__loaded) return;

    const url =
      window.location.origin +
      pathname +
      (searchParams?.toString() ? `?${searchParams.toString()}` : "");

    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, ready]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // `ready` re-renders PageviewTracker after the first init completes
  // so the initial pageview fires for users who arrive with consent
  // already granted.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function bootIfConsented() {
      if (readConsent() === "granted") {
        await initPostHog();
        if (!cancelled) setReady(true);
      }
    }
    void bootIfConsented();

    const unsubscribe = onConsentChange(async (state) => {
      if (state === "granted") {
        await initPostHog();
        if (cancelled) return;
        if (posthog?.__loaded) posthog.opt_in_capturing();
        setReady(true);
      } else if (posthog?.__loaded) {
        posthog.opt_out_capturing();
        setReady(false);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <>
      <PageviewTracker ready={ready} />
      {children}
    </>
  );
}
