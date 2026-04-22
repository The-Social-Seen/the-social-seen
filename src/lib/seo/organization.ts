/**
 * Organization JSON-LD payload — emitted on every page via the root
 * layout. Helps search engines build the brand knowledge panel and
 * link the site's social profiles back to the canonical organisation.
 *
 * `sameAs` should match the social links rendered in the footer.
 * Update both together if a new social channel is added.
 */
import { canonicalUrl, getCanonicalSiteUrl } from '@/lib/utils/site'
import { SITE_CONFIG } from '@/lib/constants'

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
    // `sameAs` deliberately omitted until launch comms confirms the real
    // Instagram + LinkedIn handles. The footer's social links currently
    // point at "#" placeholders — putting guessed slugs here would risk
    // 404s and pollute Google's Knowledge Graph for the brand. Add back
    // alongside the real footer hrefs in P2-12.
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'info@the-social-seen.com',
      areaServed: 'GB',
      availableLanguage: ['en'],
    },
  }
}
