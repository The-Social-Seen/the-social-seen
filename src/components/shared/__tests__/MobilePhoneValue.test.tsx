// @vitest-environment jsdom
//
// Direct-component coverage for MobilePhoneValue — the shared cell used by the
// admin BookingsTable + MembersTable to render a member's mobile phone (PII).
// Asserts the presentation contract in docs/UX-REVIEW-member-phone-admin.md:
// verbatim value as a whitespace-stripped tel: link with an aria-label; null →
// aria-hidden em-dash + sr-only "No mobile number" and NO link; the card
// variant carries a ≥44px tap target.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MobilePhoneValue from '../MobilePhoneValue'

describe('MobilePhoneValue — populated', () => {
  it('renders a tel: link whose href strips whitespace from the stored value', () => {
    // UX §2.2: visible text verbatim; href is digits/+ only (dialers choke on
    // spaces). '+44 7700 900111' → href="tel:+447700900111".
    const { container } = render(
      <MobilePhoneValue phoneNumber="+44 7700 900111" name="Charlotte Davis" />
    )
    const a = container.querySelector('a')!
    expect(a).toBeTruthy()
    expect(a.getAttribute('href')).toBe('tel:+447700900111')
  })

  it('shows the stored value VERBATIM as the visible text (no reformatting)', () => {
    const { container } = render(
      <MobilePhoneValue phoneNumber="+44 7700 900111" name="Charlotte Davis" />
    )
    expect(container.querySelector('a')!.textContent).toBe('+44 7700 900111')
  })

  it('carries aria-label "Call {name} on {number}" for screen-reader context', () => {
    const { container } = render(
      <MobilePhoneValue phoneNumber="+44 7700 900111" name="Charlotte Davis" />
    )
    expect(container.querySelector('a')!.getAttribute('aria-label')).toBe(
      'Call Charlotte Davis on +44 7700 900111'
    )
  })

  it('preserves an internal-space value in both href (stripped) and text (verbatim)', () => {
    // A UK-domestic shape like "07700 900000" must also strip in the href.
    const { container } = render(
      <MobilePhoneValue phoneNumber="07700 900000" name="James" />
    )
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('tel:07700900000')
    expect(a.textContent).toBe('07700 900000')
  })

  it('does NOT render the null em-dash / sr-only treatment when populated', () => {
    const { container } = render(
      <MobilePhoneValue phoneNumber="+447700900111" name="James" />
    )
    expect(container.querySelector('.sr-only')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('card variant adds a ≥44px tap target (min-h-[44px] + inline-flex)', () => {
    // UX §6.3 / admin-mobile-spec §1.7: the mobile-card link is the tap target.
    const { container } = render(
      <MobilePhoneValue phoneNumber="+447700900111" name="James" variant="card" />
    )
    const a = container.querySelector('a')!
    expect(a.className).toContain('min-h-[44px]')
    expect(a.className).toContain('inline-flex')
  })

  it('table variant (default) does NOT add the 44px card sizing', () => {
    const { container } = render(
      <MobilePhoneValue phoneNumber="+447700900111" name="James" />
    )
    expect(container.querySelector('a')!.className).not.toContain('min-h-[44px]')
  })

  it('link is whitespace-nowrap so a number never wraps mid-string', () => {
    const { container } = render(
      <MobilePhoneValue phoneNumber="+447700900111" name="James" />
    )
    expect(container.querySelector('a')!.className).toContain('whitespace-nowrap')
  })
})

describe('MobilePhoneValue — null contract', () => {
  it('INVARIANT: renders aria-hidden em-dash + sr-only "No mobile number" and NO link', () => {
    // The dash must not be read as bare punctuation; and there must be nothing
    // to dial, so no <a>/tel:.
    const { container } = render(
      <MobilePhoneValue phoneNumber={null} name="Charlotte Davis" />
    )
    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('tel:')

    const hidden = container.querySelector('[aria-hidden="true"]')!
    expect(hidden).toBeTruthy()
    expect(hidden.textContent).toBe('—') // em dash

    const srOnly = container.querySelector('.sr-only')!
    expect(srOnly).toBeTruthy()
    expect(srOnly.textContent).toBe('No mobile number')
  })

  it('null dash uses the muted text-text-tertiary token (matches the other empty cells)', () => {
    const { container } = render(
      <MobilePhoneValue phoneNumber={null} name="James" />
    )
    expect(
      container.querySelector('[aria-hidden="true"]')!.className
    ).toContain('text-text-tertiary')
  })

  it('null contract holds the same in the card variant (still no link, still sr-only label)', () => {
    const { container } = render(
      <MobilePhoneValue phoneNumber={null} name="James" variant="card" />
    )
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('.sr-only')!.textContent).toBe('No mobile number')
  })
})
