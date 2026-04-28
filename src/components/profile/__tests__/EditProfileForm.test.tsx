// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Profile, Tag } from '@/types'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/app/(member)/profile/actions', () => ({
  updateProfile: vi.fn().mockResolvedValue({ success: true }),
  updateAvatar: vi.fn().mockResolvedValue({ success: true }),
  updateInterests: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [key: string]: unknown }) => (
    <img alt={alt} src={src} />
  ),
}))

import { EditProfileForm } from '../EditProfileForm'

// ── Fixtures ───────────────────────────────────────────────────────────────────

/**
 * Representative slice of the 15 primary-eligible tags. Picked to match
 * `mockProfile.interests` below so the form's initial selection (derived
 * via label→slug lookup) is non-empty and submissions don't trip the
 * "Select at least one interest" guard.
 */
const MOCK_INTEREST_TAGS: Tag[] = [
  {
    id: 'tag-uuid-drinks-bars',
    slug: 'drinks-bars',
    label: 'Drinks & Bars',
    parent_id: null,
    sort_order: 10,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'tag-uuid-theatre-comedy',
    slug: 'theatre-comedy',
    label: 'Theatre & Comedy',
    parent_id: null,
    sort_order: 60,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'tag-uuid-sport-fitness',
    slug: 'sport-fitness',
    label: 'Sport & Fitness',
    parent_id: null,
    sort_order: 90,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'tag-uuid-wellness-mindfulness',
    slug: 'wellness-mindfulness',
    label: 'Wellness & Mindfulness',
    parent_id: null,
    sort_order: 140,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
]

const mockProfile: Profile & { interests: string[] } = {
  id: 'user-1',
  email: 'charlotte@example.com',
  full_name: 'Charlotte Moreau',
  avatar_url: null,
  job_title: 'Product Manager',
  company: 'Monzo',
  industry: 'Fintech',
  bio: 'London-based PM',
  linkedin_url: 'https://linkedin.com/in/charlotte',
  role: 'member',
  onboarding_complete: true,
  referral_source: null,
  phone_number: null,
  email_consent: false,
  email_verified: false,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  // Labels that resolve via MOCK_INTEREST_TAGS so the form starts with a
  // non-empty selection and submissions reach the action mocks.
  interests: ['Drinks & Bars', 'Theatre & Comedy'],
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('EditProfileForm', () => {
  it('T4-6: renders with existing full_name value', () => {
    render(
      <EditProfileForm
        profile={mockProfile}
        interestTags={MOCK_INTEREST_TAGS}
        open={true}
        onOpenChange={vi.fn()}
      />
    )

    const nameInput = screen.getByPlaceholderText('Your full name') as HTMLInputElement
    expect(nameInput.value).toBe('Charlotte Moreau')
  })

  it('T4-7: shows validation error when name is cleared and form submitted', () => {
    render(
      <EditProfileForm
        profile={mockProfile}
        interestTags={MOCK_INTEREST_TAGS}
        open={true}
        onOpenChange={vi.fn()}
      />
    )

    const nameInput = screen.getByPlaceholderText('Your full name')
    fireEvent.change(nameInput, { target: { value: '' } })

    const submitButton = screen.getByText('Save Changes')
    fireEvent.click(submitButton)

    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  // ── Interest-chip grid (sourced from interestTags prop) ──────────────────

  it('renders a chip for each tag passed via the interestTags prop', () => {
    render(
      <EditProfileForm
        profile={mockProfile}
        interestTags={MOCK_INTEREST_TAGS}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Drinks & Bars' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Theatre & Comedy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Wellness & Mindfulness' })).toBeTruthy()
  })

  it('renders ONLY the labels in interestTags (does not fall back to a hardcoded list)', () => {
    // Pin the prop-driven contract: a future contributor reverting the
    // chip grid to a hardcoded INTEREST_OPTIONS-style array would fail
    // this test because the fake label can't be sourced from anywhere
    // else.
    const fakeTag: Tag = {
      id: 'tag-uuid-fake',
      slug: 'fake-tag-for-test',
      label: 'Fake Tag For Test',
      parent_id: null,
      sort_order: 999,
      is_active: true,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    }

    render(
      <EditProfileForm
        // Empty `interests` so the form doesn't try to map missing labels.
        profile={{ ...mockProfile, interests: [] }}
        interestTags={[fakeTag]}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Fake Tag For Test' })).toBeTruthy()
    // Old hardcoded labels should not appear unless the prop carried them.
    expect(screen.queryByRole('button', { name: 'Wine & Cocktails' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Drinks & Bars' })).toBeNull()
  })

  it('persists the interest selection by slug, not by label', async () => {
    // Locks the action contract: updateInterests receives canonical
    // slugs (drinks-bars), never display labels (Drinks & Bars). A
    // regression that sent labels would be silently rejected by the
    // backend's slug regex.
    const { updateInterests } = await import('@/app/(member)/profile/actions')
    const updateInterestsMock = updateInterests as unknown as ReturnType<
      typeof vi.fn
    >
    updateInterestsMock.mockClear()

    render(
      <EditProfileForm
        profile={mockProfile}
        interestTags={MOCK_INTEREST_TAGS}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Save Changes'))
    await new Promise((r) => setTimeout(r, 0))

    // mockProfile.interests = ['Drinks & Bars', 'Theatre & Comedy'] →
    // resolved through MOCK_INTEREST_TAGS into the matching slugs.
    expect(updateInterestsMock).toHaveBeenCalledTimes(1)
    expect(updateInterestsMock.mock.calls[0][0]).toEqual([
      'drinks-bars',
      'theatre-comedy',
    ])
  })

  // ── CL-7: phone-number field ──────────────────────────────────────────────

  it('CL-7: renders phone input pre-populated with profile.phone_number', () => {
    render(
      <EditProfileForm
        profile={{ ...mockProfile, phone_number: '07123456789' }}
        interestTags={MOCK_INTEREST_TAGS}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )
    const phoneInput = screen.getByPlaceholderText(
      /07123 456789 or \+44 7123 456789/,
    ) as HTMLInputElement
    expect(phoneInput.value).toBe('07123456789')
  })

  it('CL-7: shows "Enter a valid phone number" when input has letters', () => {
    render(
      <EditProfileForm
        profile={mockProfile}
        interestTags={MOCK_INTEREST_TAGS}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    const phoneInput = screen.getByPlaceholderText(
      /07123 456789 or \+44 7123 456789/,
    )
    fireEvent.change(phoneInput, { target: { value: 'not-a-phone' } })
    fireEvent.click(screen.getByText('Save Changes'))

    expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
  })

  it('CL-7: passes phone_number through to updateProfile on submit', async () => {
    const { updateProfile } = await import('@/app/(member)/profile/actions')
    const updateProfileMock = updateProfile as unknown as ReturnType<
      typeof vi.fn
    >
    updateProfileMock.mockClear()

    render(
      <EditProfileForm
        profile={mockProfile}
        interestTags={MOCK_INTEREST_TAGS}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    const phoneInput = screen.getByPlaceholderText(
      /07123 456789 or \+44 7123 456789/,
    )
    fireEvent.change(phoneInput, { target: { value: '+44 7700 900111' } })
    fireEvent.click(screen.getByText('Save Changes'))

    // updateProfile fires inside startTransition; flush microtasks.
    await new Promise((r) => setTimeout(r, 0))
    expect(updateProfileMock).toHaveBeenCalledTimes(1)
    expect(updateProfileMock.mock.calls[0][0]).toMatchObject({
      phone_number: '+44 7700 900111',
    })
  })
})
