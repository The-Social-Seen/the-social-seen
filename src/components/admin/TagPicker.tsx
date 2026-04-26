'use client'

import { useMemo } from 'react'
import { PRIMARY_ELIGIBLE_TAG_SLUGS } from '@/lib/constants/tags'
import type { Tag } from '@/types'

interface TagPickerProps {
  /** Full active-tag list (15 primary-eligible + 8 interest-only). */
  availableTags: Tag[]
  /** Selected primary slug, or null when none chosen yet. */
  primarySlug: string | null
  /** Selected secondary slugs (0..N). */
  secondarySlugs: string[]
  onPrimaryChange: (slug: string) => void
  onSecondariesChange: (slugs: string[]) => void
  /** Optional inline error to surface above the chips (e.g. "Pick a primary"). */
  error?: string | null
}

/**
 * Two-zone tag picker — Phase 3 W5.
 *
 *   • Primary: radio chip group of the 15 primary-eligible tags.
 *     Exactly one selection is required at submit time (parent enforces).
 *   • Secondary: multi-select chip grid of all 23 tags.
 *
 * ⚠️ Multi-tag collision guard (W2+W3 code-review flag):
 * Selecting a tag as the primary IMMEDIATELY removes it from the secondary
 * set, and selecting a tag as a secondary that's currently primary is a
 * no-op (the secondary chip is rendered as disabled when the slug is
 * already primary). This prevents the same slug ending up in both arrays
 * — which would otherwise hit the bidirectional trigger's `uq_event_tags_
 * event_tag` unique violation when Side A tries to UPDATE the primary's
 * tag_id to a slug that already exists as a secondary on the same event.
 *
 * The Server Action (`saveEventTags`) enforces the same invariant
 * server-side — defence in depth.
 */
export default function TagPicker({
  availableTags,
  primarySlug,
  secondarySlugs,
  onPrimaryChange,
  onSecondariesChange,
  error,
}: TagPickerProps) {
  const primaryEligible = useMemo(
    () => availableTags.filter((t) => PRIMARY_ELIGIBLE_TAG_SLUGS.has(t.slug)),
    [availableTags],
  )

  // Secondary picker shows ALL active tags. Members later browse by either
  // primary or secondary, so an interest-only tag (e.g. interest-technology)
  // is a legitimate secondary on a workshop event.
  const secondaryOptions = availableTags

  const secondarySet = useMemo(
    () => new Set(secondarySlugs),
    [secondarySlugs],
  )

  function handlePrimary(slug: string) {
    onPrimaryChange(slug)
    // Remove the new primary from secondaries if it was selected there —
    // this is the W5 collision guard at the UI layer.
    if (secondarySet.has(slug)) {
      onSecondariesChange(secondarySlugs.filter((s) => s !== slug))
    }
  }

  function toggleSecondary(slug: string) {
    // Selecting the current primary as a secondary is forbidden — the chip
    // renders disabled when primary === slug, but guard here too.
    if (slug === primarySlug) return
    if (secondarySet.has(slug)) {
      onSecondariesChange(secondarySlugs.filter((s) => s !== slug))
    } else {
      onSecondariesChange([...secondarySlugs, slug])
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Primary tag ─────────────────────────────────────────────── */}
      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-text-primary">
          Primary tag{' '}
          <span className="font-normal text-text-tertiary">
            (one — the event&rsquo;s main category)
          </span>
        </legend>
        <p className="mb-3 text-xs text-text-tertiary">
          Drives the event card chip and the legacy category column.
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Primary tag">
          {primaryEligible.map((tag) => {
            const selected = primarySlug === tag.slug
            return (
              <label
                key={tag.id}
                className={[
                  'inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors',
                  selected
                    ? 'border-gold bg-gold/10 text-text-primary'
                    : 'border-border bg-transparent text-text-secondary hover:border-gold/40 hover:text-text-primary',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="primary_tag_slug"
                  value={tag.slug}
                  checked={selected}
                  onChange={() => handlePrimary(tag.slug)}
                  data-testid={`primary-tag-${tag.slug}`}
                  className="sr-only"
                />
                {tag.label}
              </label>
            )
          })}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        )}
      </fieldset>

      {/* ── Secondary tags ──────────────────────────────────────────── */}
      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-text-primary">
          Secondary tags{' '}
          <span className="font-normal text-text-tertiary">(optional — adds context)</span>
        </legend>
        <p className="mb-3 text-xs text-text-tertiary">
          Helpful for multi-tagged events (e.g. a Halloween party that&rsquo;s
          both nightlife and themed). The primary tag is hidden from this
          picker to prevent collisions.
        </p>
        <div className="flex flex-wrap gap-2">
          {secondaryOptions.map((tag) => {
            const isPrimary = primarySlug === tag.slug
            const selected = secondarySet.has(tag.slug)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleSecondary(tag.slug)}
                disabled={isPrimary}
                aria-pressed={selected}
                data-testid={`secondary-tag-${tag.slug}`}
                className={[
                  'inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-medium transition-colors',
                  isPrimary
                    ? 'cursor-not-allowed border-border/40 bg-bg-secondary text-text-tertiary opacity-60'
                    : selected
                      ? 'border-blush bg-blush/30 text-text-primary'
                      : 'border-border bg-transparent text-text-secondary hover:border-gold/40 hover:text-text-primary',
                ].join(' ')}
                title={isPrimary ? 'This tag is the primary for this event' : undefined}
              >
                {tag.label}
                {isPrimary && (
                  <span className="ml-1 text-xs font-normal text-text-tertiary">
                    (primary)
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {/* Hidden input to carry the secondary selection into the form
            payload — comma-separated slug list. The Server Action splits
            and re-validates server-side. */}
        <input
          type="hidden"
          name="secondary_tag_slugs"
          value={secondarySlugs.join(',')}
        />
      </fieldset>
    </div>
  )
}
