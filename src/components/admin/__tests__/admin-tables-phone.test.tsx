// @vitest-environment jsdom
//
// Mobile-phone column integration coverage for BookingsTable + MembersTable.
// The standalone link/null semantics live in
// src/components/shared/__tests__/MobilePhoneValue.test.tsx; THIS file pins the
// table-level contract from docs/UX-REVIEW-member-phone-admin.md that only the
// table can express:
//   - desktop <th>/<td> carry `hidden lg:table-cell`, positioned right after
//     Email (and MembersTable's Mobile <td> also `whitespace-nowrap`);
//   - the mobile-card <dl> always carries a "Mobile" pair (even when null),
//     in the spec'd position (BookingsTable: first pair; MembersTable: after
//     Company);
//   - populated → a tel: link with stripped-whitespace href + aria-label, in
//     BOTH the desktop cell and the mobile card;
//   - null → the em-dash + sr-only "No mobile number", and NO tel: link.
//
// INVARIANT: phone is PII — the table must render it as a usable contact
// affordance when present and as an unambiguous "none on file" when absent,
// without ever wrapping a bad value or leaking a phantom link on null.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/(admin)/admin/actions', () => ({
  exportEventAttendeesCSV: vi.fn(),
  setNoShow: vi.fn(),
  promoteFromWaitlist: vi.fn(),
  exportMembersCSV: vi.fn(),
  banMember: vi.fn(),
  reinstateMember: vi.fn(),
  suspendMember: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [k: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}))

import BookingsTable from '../BookingsTable'
import MembersTable from '../MembersTable'
import type { MemberWithStats } from '@/types'

// ── Fixtures (default phone null; override for the populated case) ────────────

interface TestBooking {
  id: string
  status: string
  waitlist_position: number | null
  booked_at: string
  created_at: string
  stripe_payment_id?: string | null
  stripe_refund_id?: string | null
  refunded_amount_pence?: number | null
  cancelled_at?: string | null
  profile: {
    id: string
    full_name: string
    email: string
    avatar_url: string | null
    phone_number: string | null
  } | null
}

const booking = (overrides: Partial<TestBooking> = {}): TestBooking => ({
  id: 'bk-1',
  status: 'confirmed',
  waitlist_position: null,
  booked_at: '2026-04-10T12:00:00.000Z',
  created_at: '2026-04-10T12:00:00.000Z',
  profile: {
    id: 'usr-1',
    full_name: 'Charlotte Davis',
    email: 'charlotte@example.com',
    avatar_url: null,
    phone_number: null,
  },
  ...overrides,
})

const bookingProfile = (phone: string | null) => ({
  id: 'usr-1',
  full_name: 'Charlotte Davis',
  email: 'charlotte@example.com',
  avatar_url: null,
  phone_number: phone,
})

const member = (overrides: Partial<MemberWithStats> = {}): MemberWithStats => ({
  id: 'usr-1',
  email: 'charlotte@example.com',
  full_name: 'Charlotte Davis',
  avatar_url: null,
  job_title: 'Marketing Director',
  company: 'Ogilvy',
  industry: null,
  bio: null,
  linkedin_url: null,
  role: 'member',
  onboarding_complete: true,
  referral_source: null,
  phone_number: null,
  email_consent: true,
  email_verified: true,
  status: 'active',
  created_at: '2026-01-15T00:00:00.000Z',
  updated_at: '2026-01-15T00:00:00.000Z',
  deleted_at: null,
  events_attended: 4,
  events_confirmed: 4,
  events_waitlisted: 0,
  ...overrides,
})

const PHONE = '+44 7700 900111'
const HREF = 'tel:+447700900111'

// helpers scoped to the desktop table / mobile card subtrees
const desktopTable = (c: HTMLElement) =>
  c.querySelector('div.hidden.md\\:block table') as HTMLElement
const mobileCard = (c: HTMLElement) =>
  c.querySelector('ul.md\\:hidden article') as HTMLElement

// ════════════════════════════════════════════════════════════════════════════
// BookingsTable
// ════════════════════════════════════════════════════════════════════════════

describe('BookingsTable — Mobile column placement & breakpoint', () => {
  it('desktop <th>Mobile</th> is the 3rd header (right after Email) and is hidden lg:table-cell', () => {
    const { container } = render(<BookingsTable bookings={[booking()]} eventId="evt-1" />)
    const headers = [...desktopTable(container).querySelectorAll('thead th')]
    const labels = headers.map((th) => th.textContent)
    expect(labels.slice(0, 3)).toEqual(['Name', 'Email', 'Mobile'])
    const mobileTh = headers[2]
    expect(mobileTh.className).toContain('hidden')
    expect(mobileTh.className).toContain('lg:table-cell')
  })

  it('desktop Mobile <td> carries hidden lg:table-cell (matches the column visibility)', () => {
    const { container } = render(
      <BookingsTable bookings={[booking({ profile: bookingProfile(PHONE) })]} eventId="evt-1" />
    )
    // The desktop tel: link lives inside a td.hidden.lg:table-cell.
    const link = desktopTable(container).querySelector(`a[href="${HREF}"]`)!
    const td = link.closest('td')!
    expect(td.className).toContain('hidden')
    expect(td.className).toContain('lg:table-cell')
  })
})

describe('BookingsTable — Mobile mobile-card pair', () => {
  it('the FIRST <dl> pair is the Mobile pair, present even when phone is null', () => {
    const { container } = render(<BookingsTable bookings={[booking()]} eventId="evt-1" />)
    const firstPair = mobileCard(container).querySelector('dl > div')!
    expect(firstPair.querySelector('dt')!.textContent).toBe('Mobile')
  })

  it('null phone → card shows em-dash + sr-only "No mobile number", no tel: link', () => {
    const { container } = render(<BookingsTable bookings={[booking()]} eventId="evt-1" />)
    const card = mobileCard(container)
    expect(card.querySelector('a[href^="tel:"]')).toBeNull()
    expect(card.querySelector('.sr-only')!.textContent).toBe('No mobile number')
  })

  it('populated phone → card tel: link has stripped-whitespace href, verbatim text, aria-label, and a 44px tap target', () => {
    const { container } = render(
      <BookingsTable bookings={[booking({ profile: bookingProfile(PHONE) })]} eventId="evt-1" />
    )
    const link = mobileCard(container).querySelector(`a[href="${HREF}"]`) as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.textContent).toBe(PHONE)
    expect(link.getAttribute('aria-label')).toBe('Call Charlotte Davis on +44 7700 900111')
    expect(link.className).toContain('min-h-[44px]')
  })
})

describe('BookingsTable — populated phone in desktop cell', () => {
  it('renders a tel: link with stripped-whitespace href + aria-label in the desktop table', () => {
    const { container } = render(
      <BookingsTable bookings={[booking({ profile: bookingProfile(PHONE) })]} eventId="evt-1" />
    )
    const link = desktopTable(container).querySelector(`a[href="${HREF}"]`) as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.textContent).toBe(PHONE)
    expect(link.getAttribute('aria-label')).toBe('Call Charlotte Davis on +44 7700 900111')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// MembersTable
// ════════════════════════════════════════════════════════════════════════════

describe('MembersTable — Mobile column placement & breakpoint', () => {
  it('desktop <th>Mobile</th> is the 3rd header (right after Email) and is hidden lg:table-cell', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const headers = [...desktopTable(container).querySelectorAll('thead th')]
    const labels = headers.map((th) => th.textContent)
    expect(labels.slice(0, 3)).toEqual(['Name', 'Email', 'Mobile'])
    expect(headers[2].className).toContain('hidden')
    expect(headers[2].className).toContain('lg:table-cell')
  })

  it('desktop Mobile <td> carries BOTH hidden lg:table-cell AND whitespace-nowrap (a +44 number never wraps)', () => {
    const { container } = render(<MembersTable members={[member({ phone_number: PHONE })]} />)
    const link = desktopTable(container).querySelector(`a[href="${HREF}"]`)!
    const td = link.closest('td')!
    expect(td.className).toContain('hidden')
    expect(td.className).toContain('lg:table-cell')
    expect(td.className).toContain('whitespace-nowrap')
  })
})

describe('MembersTable — Mobile mobile-card pair', () => {
  it('the Mobile <dl> pair sits AFTER Company and BEFORE Events, present even when phone is null', () => {
    // member() default has job_title + company set → Title, Company, then
    // Mobile, then Events, Joined.
    const { container } = render(<MembersTable members={[member()]} />)
    const dts = [...mobileCard(container).querySelectorAll('dl dt')].map((d) => d.textContent)
    expect(dts).toContain('Mobile')
    const companyIdx = dts.indexOf('Company')
    const mobileIdx = dts.indexOf('Mobile')
    const eventsIdx = dts.indexOf('Events')
    expect(companyIdx).toBeGreaterThanOrEqual(0)
    expect(mobileIdx).toBe(companyIdx + 1)
    expect(eventsIdx).toBe(mobileIdx + 1)
  })

  it('Mobile pair is present even when Title and Company are BOTH null (it is unconditional)', () => {
    // Title/Company rows are conditional; Mobile must still show so Sophia sees
    // "no number on file" at a glance.
    const { container } = render(
      <MembersTable members={[member({ job_title: null, company: null })]} />
    )
    const dts = [...mobileCard(container).querySelectorAll('dl dt')].map((d) => d.textContent)
    expect(dts).not.toContain('Title')
    expect(dts).not.toContain('Company')
    expect(dts).toContain('Mobile')
  })

  it('null phone → card shows em-dash + sr-only "No mobile number", no tel: link', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const card = mobileCard(container)
    expect(card.querySelector('a[href^="tel:"]')).toBeNull()
    expect(card.querySelector('.sr-only')!.textContent).toBe('No mobile number')
  })

  it('populated phone → card tel: link has stripped href, verbatim text, aria-label, 44px tap target', () => {
    const { container } = render(<MembersTable members={[member({ phone_number: PHONE })]} />)
    const link = mobileCard(container).querySelector(`a[href="${HREF}"]`) as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.textContent).toBe(PHONE)
    expect(link.getAttribute('aria-label')).toBe('Call Charlotte Davis on +44 7700 900111')
    expect(link.className).toContain('min-h-[44px]')
  })
})

describe('MembersTable — populated phone in desktop cell', () => {
  it('renders a tel: link with stripped-whitespace href + aria-label in the desktop table', () => {
    const { container } = render(<MembersTable members={[member({ phone_number: PHONE })]} />)
    const link = desktopTable(container).querySelector(`a[href="${HREF}"]`) as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.textContent).toBe(PHONE)
    expect(link.getAttribute('aria-label')).toBe('Call Charlotte Davis on +44 7700 900111')
  })
})
