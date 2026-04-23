/**
 * Mutable holder for the lazily-initialised PostHog client.
 *
 * `PostHogProvider` calls `setPostHog()` after the dynamic import +
 * `init()` resolves. Other modules read via `getPostHog()` and no-op
 * when null. This keeps `posthog-js` out of the static dependency
 * graph for callers — only the provider pulls the runtime, only after
 * consent is granted.
 */
import type { PostHog } from 'posthog-js'

let instance: PostHog | null = null

export function setPostHog(client: PostHog | null): void {
  instance = client
}

export function getPostHog(): PostHog | null {
  return instance
}
