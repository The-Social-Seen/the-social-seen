// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Profile } from '@/types'

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
  interests: ['Wine & Cocktails', 'Fine Dining'],
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('EditProfileForm', () => {
  it('T4-6: renders with existing full_name value', () => {
    render(
      <EditProfileForm
        profile={mockProfile}
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

  // ── CL-7: phone-number field ──────────────────────────────────────────────

  it('CL-7: renders phone input pre-populated with profile.phone_number', () => {
    render(
      <EditProfileForm
        profile={{ ...mockProfile, phone_number: '07123456789' }}
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
