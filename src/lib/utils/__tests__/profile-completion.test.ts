import { describe, it, expect } from 'vitest'
import {
  PROFILE_FIELD_WEIGHTS,
  computeProfileCompletion,
} from '../profile-completion'

const empty = {
  avatar_url: null,
  bio: null,
  linkedin_url: null,
  full_name: '',
  job_title: null,
  company: null,
  industry: null,
  phone_number: null,
}

describe('computeProfileCompletion', () => {
  it('field weights sum to exactly 100', () => {
    const total = Object.values(PROFILE_FIELD_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
  })

  it('returns 0 for an entirely empty profile and lists all 8 missing fields', () => {
    const r = computeProfileCompletion(empty)
    expect(r.score).toBe(0)
    expect(r.missingFields).toHaveLength(8)
  })

  it('returns 100 when every field is filled', () => {
    const r = computeProfileCompletion({
      avatar_url: 'https://example.com/a.jpg',
      bio: 'A short bio.',
      linkedin_url: 'https://linkedin.com/in/x',
      full_name: 'Anna Lee',
      job_title: 'Designer',
      company: 'Studio',
      industry: 'Design',
      phone_number: '+447700900000',
    })
    expect(r.score).toBe(100)
    expect(r.missingFields).toEqual([])
  })

  it('treats whitespace-only strings as missing', () => {
    const r = computeProfileCompletion({
      ...empty,
      full_name: '   ',
      bio: '\n\t',
    })
    expect(r.score).toBe(0)
    expect(r.missingFields).toContain('full_name')
    expect(r.missingFields).toContain('bio')
  })

  it('weights avatar (20) higher than phone (10) — partial fill scores correctly', () => {
    const onlyAvatar = computeProfileCompletion({
      ...empty,
      avatar_url: 'https://example.com/a.jpg',
    })
    const onlyPhone = computeProfileCompletion({
      ...empty,
      phone_number: '+447700900000',
    })
    expect(onlyAvatar.score).toBe(20)
    expect(onlyPhone.score).toBe(10)
  })

  it('orders missingFields by weight descending so high-impact gaps surface first', () => {
    const r = computeProfileCompletion(empty)
    // First missing field should be the heaviest weight (avatar = 20).
    expect(r.missingFields[0]).toBe('avatar_url')
    // Second should be one of the 15-weight fields (bio or linkedin_url).
    expect(['bio', 'linkedin_url']).toContain(r.missingFields[1])
  })

  it('missingLabels mirrors missingFields with human-readable text', () => {
    const r = computeProfileCompletion({
      ...empty,
      full_name: 'Anna',
      avatar_url: 'https://example.com/a.jpg',
    })
    expect(r.missingLabels).not.toContain('Profile photo')
    expect(r.missingLabels).not.toContain('Full name')
    expect(r.missingLabels).toContain('Bio')
    expect(r.missingLabels).toContain('LinkedIn')
  })
})
