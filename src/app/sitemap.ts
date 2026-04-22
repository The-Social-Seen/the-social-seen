import type { MetadataRoute } from "next";
import { getPublishedEvents } from "@/lib/supabase/queries/events";
import { canonicalUrl } from "@/lib/utils/site";

/**
 * Dynamic sitemap. Includes the public-facing static routes + every
 * published, non-cancelled event slug.
 *
 * `lastModified` strategy:
 *   - Static pages (/about, /privacy, etc.) use a baked-in per-route
 *     timestamp — roughly when the content was last materially updated.
 *     Previously we set `new Date()` at sitemap-render time, which told
 *     crawlers "all pages changed every time you fetch the sitemap" —
 *     wasteful re-crawls, especially for the legal pages that update
 *     yearly at most.
 *   - Event detail pages use the event's own `updated_at` / `created_at`
 *     so re-edited events still surface as freshly-changed.
 *
 * Bump the constants below when content on the respective static page
 * genuinely changes. Format is a fixed ISO date.
 *
 * Excludes: admin, api, profile, bookings, auth flows. Those are blocked
 * in robots.ts as well — sitemap omission is the second line of defence.
 */

// Per-route content-change timestamps. Update when the actual page
// content changes in a material way (copy edit, section added, legal
// revision). Crawlers use these to prioritise re-visits.
const ROUTE_LAST_MODIFIED = {
  "/":             new Date("2026-04-22"),
  "/events":       new Date("2026-04-22"), // superseded by event rows below
  "/events/past":  new Date("2026-04-22"),
  "/gallery":      new Date("2026-04-22"),
  "/about":        new Date("2026-04-22"),
  "/contact":      new Date("2026-04-22"),
  "/collaborate":  new Date("2026-04-22"),
  "/join":         new Date("2026-04-22"),
  "/privacy":      new Date("2026-04-21"),
  "/terms":        new Date("2026-04-21"),
} as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await getPublishedEvents();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: canonicalUrl("/"),
      lastModified: ROUTE_LAST_MODIFIED["/"],
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: canonicalUrl("/events"),
      lastModified: ROUTE_LAST_MODIFIED["/events"],
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: canonicalUrl("/events/past"),
      lastModified: ROUTE_LAST_MODIFIED["/events/past"],
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: canonicalUrl("/gallery"),
      lastModified: ROUTE_LAST_MODIFIED["/gallery"],
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: canonicalUrl("/about"),
      lastModified: ROUTE_LAST_MODIFIED["/about"],
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: canonicalUrl("/contact"),
      lastModified: ROUTE_LAST_MODIFIED["/contact"],
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: canonicalUrl("/collaborate"),
      lastModified: ROUTE_LAST_MODIFIED["/collaborate"],
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: canonicalUrl("/join"),
      lastModified: ROUTE_LAST_MODIFIED["/join"],
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: canonicalUrl("/privacy"),
      lastModified: ROUTE_LAST_MODIFIED["/privacy"],
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: canonicalUrl("/terms"),
      lastModified: ROUTE_LAST_MODIFIED["/terms"],
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
