import { cn } from '@/lib/utils/cn'

interface MobilePhoneValueProps {
  /**
   * The stored phone number, rendered verbatim (no reformatting). `null` when
   * the member set no number — renders the muted em-dash treatment.
   */
  phoneNumber: string | null
  /**
   * Person the number belongs to — used to build the `tel:` link's accessible
   * name ("Call {name} on {number}").
   */
  name: string
  /**
   * `'card'` adds a ≥44px tap target for the mobile stacked-card variant.
   * `'table'` (default) is the desktop cell, where the row height already
   * provides a comfortable click area and the 44px rule does not apply
   * (pointer-primary).
   */
  variant?: 'table' | 'card'
}

/**
 * Renders a member's mobile phone for the admin tables (BookingsTable /
 * MembersTable). Per docs/UX-REVIEW-member-phone-admin.md:
 *  - Populated → the verbatim stored string as a `tel:` link (href = value with
 *    whitespace stripped). Resting `text-text-secondary`; hover/focus `text-gold`
 *    + underline + `ring-gold/50` (matches the LinkedIn link + admin-input focus).
 *  - Null → `<span aria-hidden>—</span>` + sr-only "No mobile number", using the
 *    muted `text-text-tertiary` token (same dash as the other empty cells).
 *
 * All colours come from semantic tokens — no literal hex (CLAUDE.md LOCKED rule).
 */
export default function MobilePhoneValue({
  phoneNumber,
  name,
  variant = 'table',
}: MobilePhoneValueProps) {
  if (phoneNumber === null) {
    return (
      <>
        <span aria-hidden="true" className="text-text-tertiary">
          &mdash;
        </span>
        <span className="sr-only">No mobile number</span>
      </>
    )
  }

  // `tel:` tolerates `+` and digits; spaces are unreliable across dialers, so
  // strip whitespace from the href only — the visible text stays verbatim.
  const telHref = `tel:${phoneNumber.replace(/\s+/g, '')}`

  return (
    <a
      href={telHref}
      aria-label={`Call ${name} on ${phoneNumber}`}
      className={cn(
        'whitespace-nowrap text-text-secondary transition-colors',
        'hover:text-gold focus-visible:text-gold focus-visible:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50',
        variant === 'card' && 'inline-flex min-h-[44px] items-center py-2',
      )}
    >
      {phoneNumber}
    </a>
  )
}
