// @vitest-environment jsdom
//
// Viewport + search-bar + touch-target tests for the admin MembersTable.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/(admin)/admin/actions', () => ({
  exportMembersCSV: vi.fn(),
  banMember: vi.fn(),
  reinstateMember: vi.fn(),
  suspendMember: vi.fn(),
}))

import MembersTable from '../MembersTable'
import type { MemberWithStats } from '@/types'

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

describe('MembersTable — mobile pass', () => {
  it('renders BOTH the desktop table and the mobile card list', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    expect(container.querySelector('div.hidden.md\\:block table')).toBeTruthy()
    const mobileList = container.querySelector('ul.md\\:hidden')
    expect(mobileList).toBeTruthy()
    expect(mobileList?.querySelectorAll('li').length).toBe(1)
  })

  it('search input is at least 44px tall on mobile (h-11)', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const search = container.querySelector(
      'input[type="text"][aria-label*="Search"]'
    ) as HTMLInputElement
    expect(search).toBeTruthy()
    expect(search.className).toContain('h-11')
  })

  it('sort select is at least 44px tall on mobile (h-11) with mobile "Sort by" label', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const select = container.querySelector(
      'select[aria-label="Sort members"]'
    ) as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.className).toContain('h-11')
    // The "Sort by" hint sits above the select on mobile and is hidden at md+.
    const labelHint = select.parentElement?.querySelector('span.md\\:hidden')
    expect(labelHint?.textContent).toBe('Sort by')
  })

  it('Export CSV button is full-width and 44px tall on mobile', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const exportBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Export CSV')
    ) as HTMLButtonElement
    expect(exportBtn).toBeTruthy()
    expect(exportBtn.className).toContain('w-full')
    expect(exportBtn.className).toContain('h-11')
  })

  it('mobile card surfaces full name, email, status badge, job title, company', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent).toContain('Charlotte Davis')
    expect(card.textContent).toContain('charlotte@example.com')
    expect(card.textContent).toContain('Active')
    expect(card.textContent).toContain('Marketing Director')
    expect(card.textContent).toContain('Ogilvy')
  })

  it('mobile card uses the shorter "Title" label (not "Job Title") to fit narrow widths', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    const labels = [...card.querySelectorAll('dt')].map((l) => l.textContent)
    expect(labels).toContain('Title')
    expect(labels).not.toContain('Job Title')
  })

  it('mobile Moderate button is full-width with min-h-[44px] (touch-target compliance)', () => {
    const { container } = render(<MembersTable members={[member()]} />)
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    const actionRow = card.querySelector('div.border-t') as HTMLElement
    expect(actionRow).toBeTruthy()
    const moderate = actionRow.querySelector('button') as HTMLButtonElement
    expect(moderate).toBeTruthy()
    expect(moderate.textContent).toContain('Moderate')
    expect(moderate.className).toContain('w-full')
    expect(moderate.className).toContain('min-h-[44px]')
  })

  it('admin members render without a Moderate button and show an "Admin" tag instead', () => {
    const { container } = render(
      <MembersTable members={[member({ role: 'admin', full_name: 'Mitesh Bhimjiyani' })]} />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent).toContain('Mitesh Bhimjiyani')
    expect(card.textContent).toContain('Admin')
    // No Moderate button on admin rows.
    const actionRow = card.querySelector('div.border-t')
    expect(actionRow).toBeNull()
  })
})
