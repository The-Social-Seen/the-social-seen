import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stateless HMAC-signed tokens for newsletter confirm + unsubscribe.
 *
 * Mirrors the design of unsubscribe-token.ts — same secret, same
 * compact `payload.sig` format, same 90-day max age. Kept in a
 * separate module because the payload shape differs: here we sign
 * an `email` (strings, not uuids) plus an `action` discriminator.
 *
 * The email is included in the payload so the /newsletter/confirm
 * page can verify the signer without a DB round-trip. Tampering the
 * email produces an invalid signature.
 *
 * Action types:
 *   'confirm'     — double-opt-in after signup.
 *   'unsubscribe' — one-click unsubscribe from email body.
 */

import {
  issueUnsubscribeToken,
  verifyUnsubscribeToken,
  type VerifiedToken,
  type TokenVerifyResult,
} from './unsubscribe-token'

// Re-export the existing unsubscribe token surface so callers have
// one import path. The newsletter-specific actions live below.
export {
  issueUnsubscribeToken,
  verifyUnsubscribeToken,
  type VerifiedToken,
  type TokenVerifyResult,
}

export type NewsletterAction = 'confirm' | 'unsubscribe'

const MAX_AGE_SECONDS = 90 * 24 * 60 * 60

function getSecret(): string {
  const explicit = process.env.UNSUBSCRIBE_TOKEN_SECRET
  if (explicit && explicit.length >= 16) return explicit
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!fallback) {
    throw new Error(
      'UNSUBSCRIBE_TOKEN_SECRET is not set and SUPABASE_SERVICE_ROLE_KEY is unavailable as fallback.',
    )
  }
  return fallback
}

function b64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function b64urlDecodeString(input: string): string {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function sign(payload: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(payload).digest())
}

export function issueNewsletterToken(
  email: string,
  action: NewsletterAction,
): string {
  const payload = JSON.stringify({
    e: email.toLowerCase(),
    a: action,
    i: Math.floor(Date.now() / 1000),
  })
  const encoded = b64urlEncode(payload)
  const sig = sign(encoded, getSecret())
  return `${encoded}.${sig}`
}

export interface VerifiedNewsletterToken {
  email: string
  action: NewsletterAction
  issuedAt: number
}

export type NewsletterTokenResult =
  | { ok: true; value: VerifiedNewsletterToken }
  | { ok: false; reason: string }

export function verifyNewsletterToken(token: string): NewsletterTokenResult {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'empty_token' }
  }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }
  const [encoded, providedSig] = parts

  let expectedSig: string
  try {
    expectedSig = sign(encoded, getSecret())
  } catch (err) {
    console.warn('[newsletter-token] sign threw:', err)
    return { ok: false, reason: 'sign_error' }
  }

  const a = Buffer.from(providedSig, 'utf-8')
  const b = Buffer.from(expectedSig, 'utf-8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(b64urlDecodeString(encoded))
  } catch {
    return { ok: false, reason: 'malformed_payload' }
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { e?: unknown }).e !== 'string' ||
    typeof (parsed as { a?: unknown }).a !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'number'
  ) {
    return { ok: false, reason: 'missing_fields' }
  }

  const { e, a: action, i } = parsed as {
    e: string
    a: string
    i: number
  }

  if (action !== 'confirm' && action !== 'unsubscribe') {
    return { ok: false, reason: 'invalid_action' }
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - i
  if (ageSeconds < 0) return { ok: false, reason: 'future_issued' }
  if (ageSeconds > MAX_AGE_SECONDS) return { ok: false, reason: 'expired' }

  return {
    ok: true,
    value: {
      email: e,
      action: action as NewsletterAction,
      issuedAt: i,
    },
  }
}

export function buildNewsletterConfirmUrl(email: string): string {
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://the-social-seen.vercel.app')
  const token = issueNewsletterToken(email, 'confirm')
  return `${site.replace(/\/$/, '')}/newsletter/confirm?t=${encodeURIComponent(token)}`
}

export function buildNewsletterUnsubscribeUrl(email: string): string {
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://the-social-seen.vercel.app')
  const token = issueNewsletterToken(email, 'unsubscribe')
  return `${site.replace(/\/$/, '')}/newsletter/unsubscribe?t=${encodeURIComponent(token)}`
}
