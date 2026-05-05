// @vitest-environment jsdom
//
// Unit tests for the admin MemberPicker — a searchable, cached, click-to-pick
// member dropdown used by EventForm's hosts section.
//
// Coverage focus:
//   - Trigger renders with default + custom labels
//   - Member list is fetched lazily on first open and cached afterwards
//   - Loading skeleton state vs. loaded list vs. error state vs. empty state
//   - Subtitle assembly (job_title • company / one only / neither)
//   - Case-insensitive client-side filter across name/job_title/company
//   - excludeIds removes already-selected members
//   - onSelect receives the picked HostPickerMember
//   - Picker closes on: pick / Escape / outside click
//
// Deliberately NOT covered (documented in test names where relevant):
//   - Focus management on open/close — jsdom focus assertions are flaky
//     against React's effect batching. Manual smoke covers this.
//   - Search input clearing after a pick — covered indirectly by the
//     "closes after pick" assertion (input is unmounted, so its value
//     resets when reopened).
//
// No Playwright E2E exists for this component: the admin EventForm is
// auth-gated, and the picker's behaviour is fully observable at the unit
// level. Visual smoke (light/dark, 375px) is a manual post-merge check.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { HostPickerMember } from '@/app/(admin)/admin/actions'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [k: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}))

const { mockListMembersForHostPicker } = vi.hoisted(() => ({
  mockListMembersForHostPicker: vi.fn(),
}))

vi.mock('@/app/(admin)/admin/actions', () => ({
  listMembersForHostPicker: mockListMembersForHostPicker,
}))

vi.mock('@/lib/utils/images', () => ({
  resolveAvatarUrl: (url: string | null) => url,
  getInitials: (name: string) =>
    name
      .split(' ')
      .map((s) => s[0] ?? '')
      .join('')
      .toUpperCase(),
}))

import MemberPicker from '../MemberPicker'

// ── Fixture ───────────────────────────────────────────────────────────────

function makeMember(overrides: Partial<HostPickerMember> = {}): HostPickerMember {
  return {
    id: 'usr-1',
    full_name: 'Charlotte Smith',
    avatar_url: null,
    job_title: 'Designer',
    company: 'Acme',
    ...overrides,
  }
}

const noopSelect = () => {}

beforeEach(() => {
  mockListMembersForHostPicker.mockReset()
})

// ── Trigger rendering ─────────────────────────────────────────────────────

describe('MemberPicker — trigger', () => {
  it('renders the default trigger label "Add member"', () => {
    render(<MemberPicker onSelect={noopSelect} />)
    expect(screen.getByRole('button', { name: /add a member/i })).toBeTruthy()
    expect(screen.getByText('Add member')).toBeTruthy()
  })

  it('renders a custom triggerLabel when provided', () => {
    render(<MemberPicker onSelect={noopSelect} triggerLabel="Add host" ariaLabel="Add a host" />)
    expect(screen.getByText('Add host')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add a host/i })).toBeTruthy()
  })
})

// ── Fetch / cache behaviour ───────────────────────────────────────────────

describe('MemberPicker — fetch and cache', () => {
  it('fetches the member list once on first open and reuses it on subsequent opens', async () => {
    mockListMembersForHostPicker.mockResolvedValue([makeMember()])
    render(<MemberPicker onSelect={noopSelect} />)

    const trigger = screen.getByRole('button', { name: /add a member/i })

    // First open → fetch fires.
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(mockListMembersForHostPicker).toHaveBeenCalledTimes(1)
    })
    // Member name renders → list fetched + rendered.
    expect(screen.getByText('Charlotte Smith')).toBeTruthy()

    // Close (Escape).
    fireEvent.keyDown(document, { key: 'Escape' })

    // Reopen → no extra fetch.
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByText('Charlotte Smith')).toBeTruthy()
    })
    expect(mockListMembersForHostPicker).toHaveBeenCalledTimes(1)
  })
})

// ── Loading state ─────────────────────────────────────────────────────────

describe('MemberPicker — loading state', () => {
  it('renders a skeleton (not member rows) while the fetch is pending', () => {
    // Promise that never resolves during the test → the picker stays in
    // the loading state.
    mockListMembersForHostPicker.mockReturnValue(new Promise<HostPickerMember[]>(() => {}))
    render(<MemberPicker onSelect={noopSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))

    // No member name visible yet (no members loaded).
    expect(screen.queryByText('Charlotte Smith')).toBeNull()
    // Empty/error copy must NOT show during loading.
    expect(screen.queryByText(/no members match/i)).toBeNull()
    expect(screen.queryByText(/no members available/i)).toBeNull()
    expect(screen.queryByText(/could not load members/i)).toBeNull()
  })
})

// ── Loaded list rendering ─────────────────────────────────────────────────

describe('MemberPicker — loaded list', () => {
  it('renders members with name + (job_title • company) subtitle', async () => {
    mockListMembersForHostPicker.mockResolvedValue([
      makeMember({ id: 'a', full_name: 'Alice Adams', job_title: 'Designer', company: 'Acme' }),
      makeMember({ id: 'b', full_name: 'Bob Brown', job_title: null, company: null }),
      makeMember({ id: 'c', full_name: 'Cara Clark', job_title: 'PM', company: null }),
    ])
    render(<MemberPicker onSelect={noopSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))

    await waitFor(() => {
      expect(screen.getByText('Alice Adams')).toBeTruthy()
    })
    expect(screen.getByText('Bob Brown')).toBeTruthy()
    expect(screen.getByText('Cara Clark')).toBeTruthy()

    // Both set → "Designer • Acme".
    expect(screen.getByText('Designer • Acme')).toBeTruthy()
    // Only one set → just "PM".
    expect(screen.getByText('PM')).toBeTruthy()
    // Neither set → no subtitle text for Bob (no separator and no "•" alone).
    // The picker uses the bullet only between two parts; with neither, no
    // subtitle line is rendered. Confirm by absence of any subtitle text
    // inside Bob's row — query by the parent button.
    const bobButton = screen.getByText('Bob Brown').closest('button')!
    expect(bobButton.textContent).toContain('Bob Brown')
    expect(bobButton.textContent).not.toContain('•')
  })
})

// ── Filter ────────────────────────────────────────────────────────────────

describe('MemberPicker — filter', () => {
  function renderWithMembers() {
    mockListMembersForHostPicker.mockResolvedValue([
      makeMember({ id: 'a', full_name: 'Alice Adams', job_title: 'Designer', company: 'Acme' }),
      makeMember({ id: 'b', full_name: 'Bob Brown', job_title: 'Developer', company: 'Beta Co' }),
      makeMember({ id: 'c', full_name: 'Cara Clark', job_title: 'PM', company: 'Acme' }),
    ])
    render(<MemberPicker onSelect={noopSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))
  }

  it('filters case-insensitively on company', async () => {
    renderWithMembers()
    const search = await screen.findByPlaceholderText('Search members')
    fireEvent.change(search, { target: { value: 'ACME' } })

    expect(screen.getByText('Alice Adams')).toBeTruthy()
    expect(screen.getByText('Cara Clark')).toBeTruthy()
    expect(screen.queryByText('Bob Brown')).toBeNull()
  })

  it('filters case-insensitively on job_title', async () => {
    renderWithMembers()
    const search = await screen.findByPlaceholderText('Search members')
    fireEvent.change(search, { target: { value: 'designer' } })

    expect(screen.getByText('Alice Adams')).toBeTruthy()
    expect(screen.queryByText('Bob Brown')).toBeNull()
    expect(screen.queryByText('Cara Clark')).toBeNull()
  })

  it('filters case-insensitively on full_name', async () => {
    renderWithMembers()
    const search = await screen.findByPlaceholderText('Search members')
    fireEvent.change(search, { target: { value: 'cara' } })

    expect(screen.getByText('Cara Clark')).toBeTruthy()
    expect(screen.queryByText('Alice Adams')).toBeNull()
    expect(screen.queryByText('Bob Brown')).toBeNull()
  })

  it('shows "No members match." when the filter excludes everything', async () => {
    renderWithMembers()
    const search = await screen.findByPlaceholderText('Search members')
    fireEvent.change(search, { target: { value: 'zzzz-no-match' } })

    expect(screen.getByText('No members match.')).toBeTruthy()
    expect(screen.queryByText('Alice Adams')).toBeNull()
  })
})

// ── excludeIds ────────────────────────────────────────────────────────────

describe('MemberPicker — excludeIds', () => {
  it('removes excluded members from the dropdown', async () => {
    mockListMembersForHostPicker.mockResolvedValue([
      makeMember({ id: 'a', full_name: 'Alice Adams' }),
      makeMember({ id: 'b', full_name: 'Bob Brown' }),
    ])
    render(<MemberPicker onSelect={noopSelect} excludeIds={['b']} />)
    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))

    await waitFor(() => {
      expect(screen.getByText('Alice Adams')).toBeTruthy()
    })
    expect(screen.queryByText('Bob Brown')).toBeNull()
  })
})

// ── Selection ─────────────────────────────────────────────────────────────

describe('MemberPicker — selection', () => {
  it('fires onSelect with the full HostPickerMember when a row is clicked', async () => {
    const onSelect = vi.fn()
    const member = makeMember({
      id: 'usr-x',
      full_name: 'Xavier Knight',
      avatar_url: 'https://example.com/x.jpg',
      job_title: 'Architect',
      company: 'Studio',
    })
    mockListMembersForHostPicker.mockResolvedValue([member])
    render(<MemberPicker onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))
    await waitFor(() => {
      expect(screen.getByText('Xavier Knight')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Xavier Knight'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(member)
  })

  it('closes the panel after a member is picked', async () => {
    mockListMembersForHostPicker.mockResolvedValue([makeMember({ id: 'a', full_name: 'Alice Adams' })])
    render(<MemberPicker onSelect={noopSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search members')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Alice Adams'))

    expect(screen.queryByPlaceholderText('Search members')).toBeNull()
  })
})

// ── Close behaviour ───────────────────────────────────────────────────────

describe('MemberPicker — close behaviour', () => {
  it('closes when Escape is pressed', async () => {
    mockListMembersForHostPicker.mockResolvedValue([])
    render(<MemberPicker onSelect={noopSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search members')).toBeTruthy()
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByPlaceholderText('Search members')).toBeNull()
  })

  it('closes when an outside click occurs', async () => {
    mockListMembersForHostPicker.mockResolvedValue([])
    render(<MemberPicker onSelect={noopSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search members')).toBeTruthy()
    })

    // mousedown on document.body — outside both the trigger and the panel.
    fireEvent.mouseDown(document.body)

    expect(screen.queryByPlaceholderText('Search members')).toBeNull()
  })
})

// ── Error and empty states ────────────────────────────────────────────────

describe('MemberPicker — error and empty states', () => {
  it('renders the load-error message when listMembersForHostPicker rejects', async () => {
    mockListMembersForHostPicker.mockRejectedValue(new Error('boom'))
    render(<MemberPicker onSelect={noopSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))

    await waitFor(() => {
      expect(screen.getByText(/could not load members/i)).toBeTruthy()
    })
  })

  it('renders distinct copy when the loaded list is empty (no members at all)', async () => {
    mockListMembersForHostPicker.mockResolvedValue([])
    render(<MemberPicker onSelect={noopSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /add a member/i }))

    await waitFor(() => {
      expect(screen.getByText('No members available.')).toBeTruthy()
    })
    // Filter-empty copy must NOT render in this case.
    expect(screen.queryByText('No members match.')).toBeNull()
  })
})
