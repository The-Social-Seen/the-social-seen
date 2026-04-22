import type { MetadataRoute } from "next";
import { getPublishedEvents } from "@/lib/supabase/queries/events";
import { canonicalUrl } from "@/lib/utils/site";

/**
 * Dynamic sitemap. Includes the public-facing static routes + every
 * published, non-cancelled event slug. Updated routes use the event's
 * `updated_at` so re-edited events surface as freshly-changed to crawlers.
 *
 * Excludes: admin, api, profile, bookings, auth flows. Those are blocked
 * in robots.ts as well — sitemap omission is the second line of defence.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await getPublishedEvents();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: canonicalUrl("/"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: canonicalUrl("/events"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: canonicalUrl("/events/past"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: canonicalUrl("/gallery"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: canonicalUrl("/about"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: canonicalUrl("/contact"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: canonicalUrl("/collaborate"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: canonicalUrl("/join"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: canonicalUrl("/privacy"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: canonicalUrl("/terms"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const eventRoutes: MetadataRoute.Sitemap = events.map((event) => ({
    url: canonicalUrl(`/events/${event.slug}`),
    lastModified: new Date(event.updated_at ?? event.created_at),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticRoutes, ...eventRoutes];
}
