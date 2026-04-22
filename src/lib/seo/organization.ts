/**
 * Organization JSON-LD payload — emitted on every page via the root
 * layout. Helps search engines build the brand knowledge panel and
 * link the site's social profiles back to the canonical organisation.
 *
 * `sameAs` should match the social links rendered in the footer.
 * Update both together if a new social channel is added.
 */
import { canonicalUrl, getCanonicalSiteUrl } from '@/lib/utils/site'
import { SITE_CONFIG, SOCIAL_LINKS } from '@/lib/constants'

export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_CONFIG.name,
    description: SITE_CONFIG.description,
    url: getCanonicalSiteUrl(),
    logo: canonicalUrl('/og-image.jpg'),
    foundingLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'London',
        addressCountry: 'GB',
      },
    },
    // `sameAs` lists profiles that the search engine can use to verify
    // brand identity for the Knowledge Graph. Sourced from `SOCIAL_LINKS`
    // — the same constant the footer reads — so adding a new channel
    // (Twitter/LinkedIn/etc.) only needs one edit there. Today: just
    // Instagram. The P2-11 deferral note is now resolved.
    sameAs: Object.values(SOCIAL_LINKS),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'info@the-social-seen.com',
      areaServed: 'GB',
      availableLanguage: ['en'],
    },
  }
}
