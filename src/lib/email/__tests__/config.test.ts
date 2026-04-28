import { describe, it, expect } from 'vitest'

import { FROM_ADDRESS } from '../config'

// Regression coverage for the 2026-04-28 transactional-email outage.
//
// Before the fix, FROM_ADDRESS was 'The Social Seen <onboarding@resend.dev>',
// Resend's testing sender, which silently 403s every send to a
// non-account-owner recipient. The send wrapper catches the failure,
// logs status='failed' to notifications, and returns without throwing —
// so the bug had no loud signal: bookings still flipped to confirmed,
// only the email never landed.
//
// These tests pin the constant to a verified-domain shape so a revert
// to a sandbox sender (e.g. during local debugging) fails at the unit
// gate, not in production.
describe('email config — FROM_ADDRESS', () => {
  it('is a non-empty string', () => {
    expect(typeof FROM_ADDRESS).toBe('string')
    expect(FROM_ADDRESS.length).toBeGreaterThan(0)
  })

  it('contains a syntactically valid email address', () => {
    // Strip the optional display-name prefix: 'Display <addr@host>'
    // or bare 'addr@host'.
    const email = FROM_ADDRESS.match(/<(.+)>/)?.[1] ?? FROM_ADDRESS
    expect(email).toMatch(/^.+@.+\..+$/)
  })

  it('is NOT a Resend sandbox sender', () => {
    // Case-insensitive substring checks — catch both bare and
    // display-name forms, and any future testing-sender variants
    // on the resend.dev domain.
    const lower = FROM_ADDRESS.toLowerCase()
    expect(lower).not.toContain('@resend.dev')
    expect(lower).not.toContain('onboarding@resend.dev')
  })

  it('uses the production verified domain (the-social-seen.com)', () => {
    // Locks the verified domain. If the project ever migrates
    // domains, this test fails — that is correct: someone must
    // deliberately update this constant rather than silently
    // shipping a from-address on an unverified domain.
    expect(FROM_ADDRESS.toLowerCase()).toContain('@the-social-seen.com')
  })
})
