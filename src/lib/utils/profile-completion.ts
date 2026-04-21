/**
 * Profile completion scoring (P2-10).
 *
 * Computed in code rather than the DB so the weighting can evolve without
 * a migration. The score is intentionally weighted toward the fields that
 * matter most for community signal: avatar (recognition) and bio/LinkedIn
 * (context for other members). Phone is the least weighted because it
 * mostly serves transactional reminders, not member-to-member context.
 *
 * Total weight sums to 100. Helpers downstream display percentage and
 * a list of missing field labels.
 *
 * Note: completion is for nudges and analytics ONLY. Bookings are NOT
 * gated on completion — the kickoff plan flagged that explicitly.
 */
import type { Profile } from '@/types'

export const PROFILE_FIELD_WEIGHTS = {
  avatar_url: 20,
  bio: 15,
  linkedin_url: 15,
  full_name: 10,
  job_title: 10,
  company: 10,
  industry: 10,
  phone_number: 10,
} as const

export type ProfileFieldKey = keyof typeof PROFILE_FIELD_WEIGHTS

export const PROFILE_FIELD_LABELS: Record<ProfileFieldKey, string> = {
  avatar_url: 'Profile photo',
  bio: 'Bio',
  linkedin_url: 'LinkedIn',
  full_name: 'Full name',
  job_title: 'Job title',
  company: 'Company',
  industry: 'Industry',
  phone_number: 'Phone number',
}

export interface ProfileCompletion {
  /** 0–100 integer percentage. */
  score: number
  /** Field keys still missing (in field-weight order, descending). */
  missingFields: ProfileFieldKey[]
  /** Human-readable labels matching `missingFields`. */
  missingLabels: string[]
}

/**
 * A field counts as "filled" when it's a non-empty trimmed string.
 * Avatar/LinkedIn just need a non-empty string — we don't validate URLs
 * here; the form does that on save.
 */
function isFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function computeProfileCompletion(
  profile: Pick<Profile, ProfileFieldKey>,
): ProfileCompletion {
  let score = 0
  const missingFields: ProfileFieldKey[] = []

  // Iterate in weight-desc order so missingFields surfaces high-impact
  // gaps first in the UI.
  const ordered = (Object.entries(PROFILE_FIELD_WEIGHTS) as Array<
    [ProfileFieldKey, number]
  >).sort(([, a], [, b]) => b - a)

  for (const [key, weight] of ordered) {
    if (isFilled(profile[key])) {
      score += weight
    } else {
      missingFields.push(key)
    }
  }

  return {
    score,
    missingFields,
    missingLabels: missingFields.map((k) => PROFILE_FIELD_LABELS[k]),
  }
}
