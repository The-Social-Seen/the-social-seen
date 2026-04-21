// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Profile } from '@/types'

vi.mock('lucide-react', () => ({
  X: ({ className }: { className?: string }) => (
    <span data-testid="x-icon" className={className} />
  ),
  UserCircle: ({ className }: { className?: string }) => (
    <span data-testid="user-icon" className={className} />
  ),
}))

import { ProfileCompletionBanner } from '../ProfileCompletionBanner'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    email: 'charlotte@example.com',
    full_name: 'Charlotte Moreau',
    avatar_url: 'https://example.com/avatar.jpg',
    job_title: 'Product Designer',
    company: 'Monzo',
    industry: 'Fintech',
    bio: 'Design enthusiast',
    linkedin_url: 'https://linkedin.com/in/charlotte',
    role: 'member',
    onboarding_complete: true,
    referral_source: null,
    phone_number: '+447700900000',
    email_consent: false,
    email_verified: false,
    status: 'active',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ProfileCompletionBanner', () => {
  it('renders when score is below 100', () => {
    const profile = makeProfile({ avatar_url: null, bio: null })
    render(<ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />)
    expect(screen.getByText(/Complete your profile/)).toBeTruthy()
  })

  it('shows the computed percentage and a progress bar', () => {
    const profile = makeProfile({ avatar_url: null }) // missing avatar = 80%
    render(<ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />)
    expect(screen.getByText('80%')).toBeTruthy()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('80')
  })

  it('lists missing field labels (up to 3)', () => {
    const profile = makeProfile({
      avatar_url: null,
      bio: null,
      linkedin_url: null,
      job_title: null,
    })
    render(<ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />)
    expect(screen.getByText(/Profile photo/)).toBeTruthy()
    expect(screen.getByText(/\+ 1 more/)).toBeTruthy()
  })

  it('does not render when profile is 100% complete', () => {
    const profile = makeProfile()
    const { container } = render(
      <ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('calls onCompleteClick when the CTA is clicked', () => {
    const onComplete = vi.fn()
    const profile = makeProfile({ avatar_url: null })
    render(<ProfileCompletionBanner profile={profile} onCompleteClick={onComplete} />)
    fireEvent.click(screen.getByText(/Complete yours/))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('is dismissed when the X button is clicked', () => {
    const profile = makeProfile({ avatar_url: null })
    const { container } = render(
      <ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />,
    )
    expect(screen.getByText(/Complete your profile/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Dismiss banner'))
    expect(container.innerHTML).toBe('')
  })
})
