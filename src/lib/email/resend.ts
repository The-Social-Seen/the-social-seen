/**
 * Resend client singleton.
 *
 * NEVER import this file in client components or any file without
 * `'use server'` — it reads the secret API key from process.env.
 * The `server-only` import enforces this at build time.
 */
import 'server-only'
import { Resend } from 'resend'

let client: Resend | null = null

/**
 * Lazy singleton — created on first use. Throws a clear error if the
 * RESEND_API_KEY env var is missing rather than failing silently.
 */
export function getResendClient(): Resend {
  if (client) return client

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error(
      'Missing RESEND_API_KEY env var. Add it to .env.local. ' +
        'Get one at https://resend.com → API Keys.',
    )
  }

  client = new Resend(apiKey)
  return client
}
