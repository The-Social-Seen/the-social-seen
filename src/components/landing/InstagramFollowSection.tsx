import { Instagram } from 'lucide-react'
import { SOCIAL_LINKS } from '@/lib/constants'

interface InstagramFollowSectionProps {
  /**
   * Visual variant. `card` is the boxed module used inline within
   * pages; `banner` is the full-bleed dark variant for end-of-page
   * placement (Gallery, booking-success).
   */
  variant?: 'card' | 'banner'
  /**
   * Optional override on the headline. Defaults sensibly per variant.
   */
  headline?: string
}

const HANDLE = '@the_social_seen'

/**
 * Static "Follow us on Instagram" CTA. Links out to the brand's
 * Instagram profile. P2-12 deliberately ships the static-CTA variant
 * rather than a live oEmbed feed — Meta's Instagram oEmbed endpoint
 * has required a Facebook App token since 2020, which is gated on
 * Meta's app-review process and out of scope for this batch.
 *
 * Live post embedding is tracked as a Phase 3 follow-up.
 */
export function InstagramFollowSection({
  variant = 'card',
  headline,
}: InstagramFollowSectionProps) {
  if (variant === 'banner') {
    return (
      <section className="bg-charcoal px-6 py-16 md:py-24">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <Instagram aria-hidden="true" className="h-10 w-10 text-gold" />
          <h2 className="mt-4 font-serif text-3xl font-bold text-white md:text-4xl">
            {headline ?? 'Follow the moments as they happen'}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/70">
            Behind-the-scenes shots, last-minute invites, and the post-event
            highlights live on our Instagram first.
          </p>
          <a
            href={SOCIAL_LINKS.instagram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Follow ${HANDLE} on Instagram (opens in a new tab)`}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold-hover"
          >
            <Instagram aria-hidden="true" className="h-4 w-4" />
            Follow {HANDLE}
          </a>
        </div>
      </section>
    )
  }

  return (
    <aside className="rounded-xl border border-gold/20 bg-gold/5 p-6 md:p-8">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Instagram aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-gold" />
          <div className="min-w-0">
            <h2 className="font-serif text-lg text-text-primary">
              {headline ?? 'Follow us on Instagram'}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Behind-the-scenes from every event at {HANDLE}.
            </p>
          </div>
        </div>
        <a
          href={SOCIAL_LINKS.instagram}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Follow ${HANDLE} on Instagram (opens in a new tab)`}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover"
        >
          <Instagram aria-hidden="true" className="h-4 w-4" />
          Follow
        </a>
      </div>
    </aside>
  )
}
