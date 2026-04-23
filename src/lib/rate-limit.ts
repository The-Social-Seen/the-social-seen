/**
 * In-memory sliding-window rate limiter.
 *
 * Purpose: application-layer brute-force brake on auth endpoints.
 * Supabase's own auth rate-limits run upstream (one OTP/60s, etc.) but
 * a slow drip of password attempts can sit under their threshold while
 * still being abuse. This caps attempts per (key, window) before we
 * even hand the credentials to Supabase.
 *
 * Caveats (call out before tightening):
 *   - **Single-instance only.** State is process-local. On Vercel each
 *     serverless instance has its own Map, so an attacker hitting many
 *     instances escapes the cap. At our scale a) most requests land on
 *     a small number of warm instances and b) Supabase's per-account
 *     limit catches per-email abuse upstream. If we outgrow either,
 *     swap the Map for Vercel KV / Upstash with the same interface.
 *   - **No persistence.** A restart drops counters. Acceptable.
 *   - **No backoff.** Attempts beyond the cap fail uniformly until the
 *     window slides; we don't escalate cooldowns.
 *
 * Tests: `src/lib/__tests__/rate-limit.test.ts`.
 */

interface Bucket {
  /** Sorted attempt timestamps (ms since epoch). */
  attempts: number[]
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  /** True if the current attempt is allowed; false if it should be blocked. */
  allowed: boolean
  /**
   * Number of attempts (including the just-recorded one) currently in
   * the window. Useful for emitting telemetry without exposing it to
   * the user.
   */
  count: number
  /** Total cap for this key. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface RateLimitOpts {
  /** Maximum allowed attempts within the window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

/**
 * Record an attempt against `key` and report whether it's allowed.
 * Counts the attempt **regardless of allow/block** so abusive callers
 * don't unbalance the window by burning through it.
 *
 * Pass a stable composite key — e.g. `login:ip:1.2.3.4` or
 * `login:email:foo@example.com`. Different keys have independent windows.
 */
export function recordAttempt(
  key: string,
  opts: RateLimitOpts,
): RateLimitResult {
  const now = Date.now()
  const cutoff = now - opts.windowMs

  const bucket = buckets.get(key) ?? { attempts: [] }
  // Drop expired entries — keeps the array bounded by `limit + small`.
  while (bucket.attempts.length > 0 && bucket.attempts[0] < cutoff) {
    bucket.attempts.shift()
  }
  bucket.attempts.push(now)
  buckets.set(key, bucket)

  return {
    allowed: bucket.attempts.length <= opts.limit,
    count: bucket.attempts.length,
    limit: opts.limit,
    windowMs: opts.windowMs,
  }
}

/**
 * Read the current attempt count for `key` within the window WITHOUT
 * recording a new attempt. Use to short-circuit callers who are
 * already over the limit before doing any expensive work.
 *
 * Returns 0 for an unknown key. Drops expired entries as a side effect
 * so memory pressure stays bounded.
 */
export function peekAttempts(key: string, opts: RateLimitOpts): number {
  const cutoff = Date.now() - opts.windowMs
  const bucket = buckets.get(key)
  if (!bucket) return 0
  while (bucket.attempts.length > 0 && bucket.attempts[0] < cutoff) {
    bucket.attempts.shift()
  }
  return bucket.attempts.length
}

/**
 * Test-only — drop every bucket. Used by Vitest cases that share module
 * state between tests.
 */
export function __TEST_ONLY__resetRateLimits(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__TEST_ONLY__resetRateLimits must not be called outside of tests.',
    )
  }
  buckets.clear()
}
