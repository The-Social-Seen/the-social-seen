/**
 * Stripe server client. Singleton — Stripe SDK instances are cheap to
 * create but a single shared instance keeps the TCP connection pool warm
 * across Server Actions and the webhook route.
 *
 * NEVER import this file from a Client Component. The `STRIPE_SECRET_KEY`
 * must not leak into the browser bundle.
 *
 * Usage:
 *   import { getStripeClient } from '@/lib/stripe/server'
 *   const stripe = getStripeClient()
 *   const session = await stripe.checkout.sessions.create({ ... })
 */
import 'server-only'
import Stripe from 'stripe'

let client: Stripe | null = null

export function getStripeClient(): Stripe {
  if (client) return client

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add it to .env.local (see .env.example).',
    )
  }

  client = new Stripe(key, {
    // Pin the API version — prevents Stripe pushing a breaking change
    // into production. Update deliberately when upgrading.
    apiVersion: '2026-03-25.dahlia',
    // Tag our requests in Stripe's dashboard for easier filtering.
    appInfo: {
      name: 'The Social Seen',
      version: '0.1.0',
    },
    // `typescript: true` is the default in Stripe SDK v22+.
  })

  return client
}

export const STRIPE_API_VERSION = '2026-03-25.dahlia'
