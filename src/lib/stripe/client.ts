/**
 * Browser-side Stripe loader. Wraps @stripe/stripe-js so components
 * reuse a single lazy-loaded Stripe.js instance.
 *
 * NOTE: The current P2-7a Checkout flow uses a server-side redirect
 * (Server Action returns the Stripe-hosted URL and the client navigates
 * there). That doesn't need Stripe.js at all. This loader is in place
 * for two future paths:
 *   1. Stripe Elements if we ever embed a custom card form.
 *   2. Apple Pay / Google Pay payment requests on the ticket page.
 *
 * Safe to import from Client Components — only the publishable key is
 * exposed.
 */
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js'

let promise: Promise<StripeJs | null> | null = null

export function getStripeBrowser(): Promise<StripeJs | null> {
  if (promise) return promise

  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  if (!key) {
    console.warn(
      '[stripe/client] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set. Stripe.js will not load.',
    )
    promise = Promise.resolve(null)
    return promise
  }

  promise = loadStripe(key)
  return promise
}
