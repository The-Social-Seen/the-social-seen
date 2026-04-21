/**
 * P2-8b — Cookie consent storage + helpers.
 *
 * Single source of truth for whether the user has consented to
 * analytics cookies. `strictly-necessary` cookies (session cookie,
 * theme preference) aren't gated on consent.
 *
 * We store in localStorage so the choice persists without setting a
 * cookie ourselves pre-consent (which would be circular). Valid
 * values:
 *   • `null` — no decision yet (first visit → banner visible).
 *   • `'granted'` — PostHog initialises, pageviews tracked.
 *   • `'denied'` — PostHog never loads. `posthog-js` isn't imported
 *     at all until the provider's `useEffect` resolves to granted.
 *
 * Changes fire a custom `DOMEvent` ('tss:analytics-consent') on
 * `window` so the PostHog provider can react in-place without a
 * page reload.
 */

export type ConsentState = 'granted' | 'denied'

const STORAGE_KEY = 'tss_analytics_consent'
const EVENT_NAME = 'tss:analytics-consent'

export function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'granted' || raw === 'denied' ? raw : null
  } catch {
    // Storage unavailable (private mode in some browsers) — treat as
    // no decision. Banner will show every visit, which is annoying but
    // correct-under-GDPR behaviour.
    return null
  }
}

export function writeConsent(state: ConsentState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, state)
  } catch {
    // Swallow — see readConsent.
  }
  // Notify listeners (PostHog provider) without requiring a reload.
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: state }))
}

/**
 * Subscribe to consent changes. Returns an unsubscribe function.
 * Callback fires synchronously with the new state after it's written.
 */
export function onConsentChange(
  handler: (state: ConsentState) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const custom = e as CustomEvent<ConsentState>
    if (custom.detail === 'granted' || custom.detail === 'denied') {
      handler(custom.detail)
    }
  }
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
