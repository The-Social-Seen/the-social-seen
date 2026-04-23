/**
 * Typed analytics tracking helper.
 *
 * Add new events to `AnalyticsEvents` to keep naming consistent.
 * Safe to call on the server — it's a no-op outside the browser.
 *
 * Reads the PostHog client from the shared module holder rather than
 * importing `posthog-js` directly, so the SDK stays out of the bundle
 * for visitors who decline analytics consent (CL-7).
 */

import { getPostHog } from "./posthog-instance";

export interface AnalyticsEvents {
  sign_up: {
    method: "email";
    /** Per-channel marketing consent captured at signup (UK PECR). */
    email_consent: boolean;
    sms_consent: boolean;
  };
  sign_up_completed: { interests_count: number };
  login: { method: "email" };
  logout: Record<string, never>;
  password_reset_requested: Record<string, never>;
  password_reset_completed: Record<string, never>;
  email_verification_requested: { source: "banner" | "modal" | "direct" };
  email_verification_completed: Record<string, never>;
  email_verification_failed: {
    reason: "invalid_code" | "rate_limit" | "send_failed" | "other";
  };
  event_view: { event_id: string; event_slug: string };
  booking_created: {
    event_id: string;
    event_slug: string;
    status: "confirmed" | "waitlisted" | "pending_payment";
    price_pence: number;
  };
  booking_cancelled: { event_id: string; booking_id: string };
  profile_updated: { fields: string[] };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * Track a PostHog event with type-checked properties.
 */
export function track<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEvents[E],
): void {
  if (typeof window === "undefined") return;
  const ph = getPostHog();
  if (!ph?.__loaded) return;
  ph.capture(event, properties);
}

/**
 * Associate the current session with a logged-in user.
 * Call on login and sign-up completion. Never pass PII beyond the user id —
 * PostHog stores these on the person profile.
 */
export function identifyUser(
  userId: string,
  traits?: { email?: string; is_admin?: boolean },
): void {
  if (typeof window === "undefined") return;
  const ph = getPostHog();
  if (!ph?.__loaded) return;
  ph.identify(userId, traits);
}

/**
 * Reset session on logout so subsequent events are anonymous.
 */
export function resetAnalytics(): void {
  if (typeof window === "undefined") return;
  const ph = getPostHog();
  if (!ph?.__loaded) return;
  ph.reset();
}
