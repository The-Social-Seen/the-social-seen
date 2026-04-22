/**
 * Event JSON-LD payload — emitted on the event detail page.
 *
 * Extended in P2-11 with:
 *   - AggregateRating when the event has visible reviews (helps Google
 *     surface star ratings in result snippets).
 *   - Performer entries from the event hosts (gives search engines a
 *     people graph link back to the host profiles).
 *
 * Hazard preserved from P2-5: when `venue_revealed = false`, the
 * location is intentionally vague so we don't leak the venue early.
 * Do NOT switch to the real venue here — the kickoff plan called this
 * out explicitly.
 */
import type { EventDetail } from '@/types'
import { canonicalUrl, getCanonicalSiteUrl } from '@/lib/utils/site'
import { resolveEventImage } from '@/lib/utils/images'

export function eventJsonLd(event: EventDetail): Record<string, unknown> {
  const ogImage = resolveEventImage(event.image_url)
  const eventUrl = canonicalUrl(`/events/${event.slug}`)

  const location = event.venue_revealed
    ? {
        '@type': 'Place',
        name: event.venue_name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: event.venue_address,
          addressLocality: 'London',
          postalCode: event.postcode ?? undefined,
          addressCountry: 'GB',
        },
      }
    : {
        '@type': 'Place',
        name: 'Venue revealed 1 week before the event',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'London',
          addressCountry: 'GB',
        },
      }

  // AggregateRating — only emit when there's at least one visible
  // review. Schema.org rejects ratingCount = 0 / ratingValue = 0
  // (rich-result preview shows the warning).
  const aggregateRating =
    event.review_count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: event.avg_rating,
            ratingCount: event.review_count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}

  // Performers — derived from event_hosts. We map each host to a
  // Person with name + jobTitle + (optional) URL pointing at the
  // organisation if no individual profile page exists yet.
  const performer =
    event.hosts.length > 0
      ? {
          performer: event.hosts.map((h) => ({
            '@type': 'Person',
            name: h.profile.full_name,
            ...(h.profile.job_title ? { jobTitle: h.profile.job_title } : {}),
            ...(h.profile.company
              ? {
                  worksFor: {
                    '@type': 'Organization',
                    name: h.profile.company,
                  },
                }
              : {}),
          })),
        }
      : {}

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.short_description,
    startDate: event.date_time,
    endDate: event.end_time,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location,
    organizer: {
      '@type': 'Organization',
      name: 'The Social Seen',
      url: getCanonicalSiteUrl(),
    },
    offers: {
      '@type': 'Offer',
      // Schema.org Offer.price is in the units of priceCurrency. Our
      // `events.price` column stores pence (3500 = £35) for ledger
      // precision, so divide before serialising. String-form keeps the
      // decimal exact — JSON-LD validators accept both number and string
      // but string sidesteps any 34.99999... float artefact and matches
      // Google's rich-result examples.
      price: (event.price / 100).toFixed(2),
      priceCurrency: 'GBP',
      availability:
        event.capacity === null || (event.spots_left ?? 1) > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/SoldOut',
      url: eventUrl,
    },
    url: eventUrl,
    ...(ogImage ? { image: ogImage } : {}),
    ...performer,
    ...aggregateRating,
  }
}
