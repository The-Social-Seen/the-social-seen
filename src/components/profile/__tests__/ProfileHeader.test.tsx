// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Profile } from '@/types'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [k: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
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

import { ProfileHeader } from '../ProfileHeader'

// ── Fixture builder ────────────────────────────────────────────────────────
//
// Returns a complete Profile + { interests } object so tests can spread
// per-case overrides without filling in 20 unrelated fields each time.
// Default values are deliberately "all set" so a test asserting absence
// only has to null out the one field it cares about.

function makeProfile(
  overrides: Partial<Profile & { interests: string[] }> = {},
): Profile & { interests: string[] } {
  return {
    id: 'user-1',
    email: 'charlotte@example.com',
    full_name: 'Charlotte Smith',
    avatar_url: null,
    job_title: 'Senior Designer',
    company: 'Acme Studio',
    industry: 'Design',
    bio: 'Loves wine and weekend supper clubs.',
    linkedin_url: 'https://linkedin.com/in/charlotte',
    role: 'member',
    onboarding_complete: true,
    referral_source: null,
    phone_number: '+447700900000',
    email_consent: true,
    email_verified: true,
    status: 'active',
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    deleted_at: null,
    interests: ['Wine', 'Supper clubs'],
    ...overrides,
  }
}

const noop = () => {}

describe('ProfileHeader — new field rendering', () => {
  it('always renders profile.email in the metadata row', () => {
    render(<ProfileHeader profile={makeProfile()} onEditClick={noop} />)

    expect(screen.getByText('charlotte@example.com')).toBeTruthy()
  })

  it('renders profile.industry when set', () => {
    render(
      <ProfileHeader
        profile={makeProfile({ industry: 'Finance' })}
        onEditClick={noop}
      />,
    )

    expect(screen.getByText('Finance')).toBeTruthy()
  })

  it('does NOT render an industry chip when industry is null', () => {
    render(
      <ProfileHeader
        profile={makeProfile({
          job_title: null,
          company: null,
          industry: null,
        })}
        onEditClick={noop}
      />,
    )

    // The fixture default 'Design' is gone and nothing else in the fixture
    // contains the word — guard against collateral text matches.
    expect(screen.queryByText('Design')).toBeNull()
    expect(screen.queryByText('Finance')).toBeNull()
  })
})

describe('ProfileHeader — bullet-separator combinatorics', () => {
  // Helper: count bullet separator spans in the top metadata row. The
  // bullet character is `•` and is the only place this character appears
  // in the component's output.
  function bulletCount(): number {
    return screen.queryAllByText('•').length
  }

  it('renders two bullets when job_title + company + industry are all present', () => {
    render(
      <ProfileHeader
        profile={makeProfile({
          job_title: 'Senior Designer',
          company: 'Acme Studio',
          industry: 'Design',
        })}
        onEditClick={noop}
      />,
    )

    expect(screen.getByText('Senior Designer')).toBeTruthy()
    expect(screen.getByText('Acme Studio')).toBeTruthy()
    expect(screen.getByText('Design')).toBeTruthy()
    expect(bulletCount()).toBe(2)
  })

  it('renders one bullet for job_title + industry (company missing — no orphan bullet)', () => {
    render(
      <ProfileHeader
        profile={makeProfile({
          job_title: 'Senior Designer',
          company: null,
          industry: 'Design',
        })}
        onEditClick={noop}
      />,
    )

    expect(screen.getByText('Senior Designer')).toBeTruthy()
    expect(screen.getByText('Design')).toBeTruthy()
    expect(bulletCount()).toBe(1)
  })

  it('renders one bullet for company + industry only', () => {
    render(
      <ProfileHeader
        profile={makeProfile({
          job_title: null,
          company: 'Acme Studio',
          industry: 'Design',
        })}
        onEditClick={noop}
      />,
    )

    expect(screen.getByText('Acme Studio')).toBeTruthy()
    expect(screen.getByText('Design')).toBeTruthy()
    expect(bulletCount()).toBe(1)
  })

  it('renders zero bullets when only one chip is present (industry alone)', () => {
    render(
      <ProfileHeader
        profile={makeProfile({
          job_title: null,
          company: null,
          industry: 'Design',
        })}
        onEditClick={noop}
      />,
    )

    expect(screen.getByText('Design')).toBeTruthy()
    expect(bulletCount()).toBe(0)
  })

  it('renders zero bullets when only one chip is present (job_title alone)', () => {
    render(
      <ProfileHeader
        profile={makeProfile({
          job_title: 'Senior Designer',
          company: null,
          industry: null,
        })}
        onEditClick={noop}
      />,
    )

    expect(screen.getByText('Senior Designer')).toBeTruthy()
    expect(bulletCount()).toBe(0)
  })

  it('omits the entire chip row when job_title, company, and industry are all null', () => {
    render(
      <ProfileHeader
        profile={makeProfile({
          job_title: null,
          company: null,
          industry: null,
        })}
        onEditClick={noop}
      />,
    )

    expect(bulletCount()).toBe(0)
    // Defaults are present in `makeProfile` — null out and confirm none
    // of the three values from the default fixture leak through.
    expect(screen.queryByText('Senior Designer')).toBeNull()
    expect(screen.queryByText('Acme Studio')).toBeNull()
    expect(screen.queryByText('Design')).toBeNull()
  })
})

describe('ProfileHeader — regression on existing fields', () => {
  it('renders full_name, job_title, company, and bio when all set', () => {
    render(<ProfileHeader profile={makeProfile()} onEditClick={noop} />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Charlotte Smith' }),
    ).toBeTruthy()
    expect(screen.getByText('Senior Designer')).toBeTruthy()
    expect(screen.getByText('Acme Studio')).toBeTruthy()
    expect(
      screen.getByText('Loves wine and weekend supper clubs.'),
    ).toBeTruthy()
  })

  it('renders the LinkedIn link when linkedin_url is set', () => {
    render(<ProfileHeader profile={makeProfile()} onEditClick={noop} />)

    const link = screen.getByRole('link', { name: /linkedin/i })
    expect(link.getAttribute('href')).toBe('https://linkedin.com/in/charlotte')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders the phone number when phone_number is set', () => {
    render(<ProfileHeader profile={makeProfile()} onEditClick={noop} />)

    expect(screen.getByText('+447700900000')).toBeTruthy()
  })

  it('renders interest tags when present', () => {
    render(<ProfileHeader profile={makeProfile()} onEditClick={noop} />)

    expect(screen.getByText('Wine')).toBeTruthy()
    expect(screen.getByText('Supper clubs')).toBeTruthy()
  })
})

describe('ProfileHeader — Edit Profile button', () => {
  it('calls onEditClick when the Edit Profile button is clicked', () => {
    const onEdit = vi.fn()

    render(<ProfileHeader profile={makeProfile()} onEditClick={onEdit} />)

    fireEvent.click(screen.getByRole('button', { name: /edit profile/i }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
