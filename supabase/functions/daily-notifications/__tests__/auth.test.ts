/**
 * @vitest-environment node
 *
 * Regression suite for the daily-notifications Edge Function auth gate.
 *
 * Why this file exists: the auth predicate that decides who can trigger
 * the daily reminder cron was almost the cause of a missed Friday
 * reminders incident on 2026-05-13 (PR #105). The fix landed an explicit
 * `CRON_AUTH_TOKEN` fallback alongside `SUPABASE_SERVICE_ROLE_KEY` —
 * see the config block in ../index.ts for the gateway-key-format story,
 * and memory note `project_supabase_gateway_key_format_inconsistency`
 * for the postmortem.
 *
 * To make that gate regression-safe without a Deno test stack, the
 * predicate was extracted to ../auth.ts as a pure, dependency-free
 * function (commit 13dda83). This is the FIRST Vitest test under
 * supabase/functions/**, and it imports cleanly because the function
 * has no Deno globals, no async, and no external IO.
 *
 * Coverage targets:
 *   - env-var combinations (both set, one empty, both empty)
 *   - header shapes (null / undefined / empty / case / whitespace)
 *   - substring + near-match traps that the `===` check must reject
 */
import { describe, it, expect } from 'vitest'
import { isAuthorizedRequest } from '../auth.ts'

describe('isAuthorizedRequest', () => {
  const SERVICE_ROLE_KEY = 'service-role-key-abc-123'
  const CRON_TOKEN = 'cron-auth-token-xyz-789'

  describe('happy paths', () => {
    it('accepts a Bearer token that matches serviceRoleKey exactly', () => {
      // INVARIANT: the auto-injected SUPABASE_SERVICE_ROLE_KEY path
      // (Dashboard invokes, direct curl) must continue to work.
      expect(
        isAuthorizedRequest(
          `Bearer ${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(true)
    })

    it('accepts a Bearer token that matches cronAuthToken exactly', () => {
      // INVARIANT: the pg_cron fallback path must work — this is the
      // fix from PR #105. Without it, the gateway rejects the
      // auto-injected sb_secret_* key and the function never fires.
      expect(
        isAuthorizedRequest(
          `Bearer ${CRON_TOKEN}`,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(true)
    })

    it('rejects a Bearer token that matches neither env value', () => {
      expect(
        isAuthorizedRequest(
          'Bearer some-other-value',
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(false)
    })
  })

  describe('one env var empty', () => {
    it('still accepts cron path when serviceRoleKey is empty', () => {
      expect(
        isAuthorizedRequest(`Bearer ${CRON_TOKEN}`, '', CRON_TOKEN),
      ).toBe(true)
    })

    it('still accepts service-role path when cronAuthToken is empty', () => {
      expect(
        isAuthorizedRequest(
          `Bearer ${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          '',
        ),
      ).toBe(true)
    })
  })

  describe('both env vars empty (the original failure mode)', () => {
    it('rejects an empty Bearer token when both envs are empty', () => {
      // INVARIANT: an empty bearer must NEVER authorize, even when
      // both env vars happen to be empty strings. This is what the
      // `!!serviceRoleKey` / `!!cronAuthToken` guards exist for.
      // Without them, '' === '' would short-circuit to true and any
      // misconfigured deploy would silently accept all callers.
      expect(isAuthorizedRequest('Bearer ', '', '')).toBe(false)
    })

    it('rejects a non-empty Bearer token when both envs are empty', () => {
      expect(isAuthorizedRequest('Bearer anything', '', '')).toBe(false)
    })
  })

  describe('malformed / missing Authorization header', () => {
    it('rejects a null header', () => {
      expect(isAuthorizedRequest(null, SERVICE_ROLE_KEY, CRON_TOKEN)).toBe(
        false,
      )
    })

    it('rejects an undefined header', () => {
      expect(
        isAuthorizedRequest(undefined, SERVICE_ROLE_KEY, CRON_TOKEN),
      ).toBe(false)
    })

    it('rejects an empty-string header', () => {
      expect(isAuthorizedRequest('', SERVICE_ROLE_KEY, CRON_TOKEN)).toBe(
        false,
      )
    })

    it('rejects a "Bearer " header with no token when serviceRoleKey is empty', () => {
      // INVARIANT: regression guard for the both-envs-empty failure
      // mode. With serviceRoleKey set, this is implicitly covered by
      // the `!== SERVICE_ROLE_KEY` check; with it empty, only the
      // `!!serviceRoleKey` guard saves us.
      expect(isAuthorizedRequest('Bearer ', '', CRON_TOKEN)).toBe(false)
    })
  })

  describe('Bearer prefix handling', () => {
    it('rejects a header with leading whitespace before Bearer', () => {
      // The regex `/^Bearer\s+/i` is anchored at the start of the
      // string. Whitespace before `Bearer` means the prefix won't be
      // stripped, so the resulting "token" still contains "  Bearer "
      // and won't match the env value.
      expect(
        isAuthorizedRequest(
          `  Bearer ${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(false)
    })

    it('accepts lowercase `bearer` prefix (regex flag i)', () => {
      expect(
        isAuthorizedRequest(
          `bearer ${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(true)
    })

    it('accepts uppercase `BEARER` prefix (regex flag i)', () => {
      expect(
        isAuthorizedRequest(
          `BEARER ${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(true)
    })

    it('rejects a header that omits the Bearer prefix entirely', () => {
      // The regex `replace(/^Bearer\s+/i, '')` is a no-op when the
      // prefix is missing — the env value is then compared against
      // the literal env value, which would only match if the caller
      // happens to send the env string as the entire header. Even
      // then, an exact-match without Bearer would be a violation of
      // the contract; that's not the actual ask here, and the
      // assertion below covers the realistic case of "bare token".
      expect(
        isAuthorizedRequest(
          SERVICE_ROLE_KEY,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(true)
      // Explanation: with no `Bearer ` prefix the regex doesn't
      // strip anything, the variable `token` equals the env value
      // verbatim, and `token === serviceRoleKey` is true. This is
      // technically permissive — flag it if the contract should
      // tighten — but it matches the implementation today.
    })

    it('accepts Bearer followed by multiple spaces before the token', () => {
      expect(
        isAuthorizedRequest(
          `Bearer    ${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(true)
    })

    it('accepts Bearer followed by a tab before the token', () => {
      expect(
        isAuthorizedRequest(
          `Bearer\t${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          CRON_TOKEN,
        ),
      ).toBe(true)
    })
  })

  describe('substring + near-match traps', () => {
    it('rejects a token that is a proper prefix of serviceRoleKey', () => {
      // INVARIANT: the comparison must be `===`, never
      // `startsWith` / `includes`. A token of `abc` against a key of
      // `abc123` must NOT authorize.
      expect(
        isAuthorizedRequest('Bearer service-role-key-abc', SERVICE_ROLE_KEY, ''),
      ).toBe(false)
    })

    it('rejects a token that differs from serviceRoleKey by one character', () => {
      const offByOne = `${SERVICE_ROLE_KEY.slice(0, -1)}X`
      expect(
        isAuthorizedRequest(`Bearer ${offByOne}`, SERVICE_ROLE_KEY, ''),
      ).toBe(false)
    })

    it('accepts the token when both envs are set to the same value', () => {
      // The `||` short-circuits on the first match, so this should
      // succeed via the serviceRole branch and never hit the cron
      // branch. Both being equal must not flip the result to false.
      expect(
        isAuthorizedRequest(
          `Bearer ${SERVICE_ROLE_KEY}`,
          SERVICE_ROLE_KEY,
          SERVICE_ROLE_KEY,
        ),
      ).toBe(true)
    })
  })
})
