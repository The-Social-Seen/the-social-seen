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
    // Schema.org `Organization.logo` is used by Google's Knowledge Panel.
    // The spec accepts a URL string but strongly recommends an ImageObject
    // with explicit dimensions — the panel's layout reserves a near-square
    // area, and a 1200×630 OG image gets cropped badly. If / when a
    // dedicated square asset ships at /logo.png (600×600, brand
    // background), Google Search Console will pick up the richer shape
    // automatically; no code change needed.
    //
    // For now we point at /og-image.jpg but still emit as an ImageObject
    // so the schema is future-proof.
    logo: {
      '@type': 'ImageObject',
      url: canonicalUrl('/og-image.jpg'),
      width: 1200,
      height: 630,
    },
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
