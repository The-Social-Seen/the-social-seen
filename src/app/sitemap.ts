import type { MetadataRoute } from "next";
import { getPublishedEvents } from "@/lib/supabase/queries/events";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await getPublishedEvents();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: "https://thesocialseen.com",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://thesocialseen.com/events",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: "https://thesocialseen.com/gallery",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: "https://thesocialseen.com/join",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];

  const eventRoutes: MetadataRoute.Sitemap = events.map((event) => ({
    url: `https://thesocialseen.com/events/${event.slug}`,
    lastModified: new Date(event.updated_at ?? event.created_at),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticRoutes, ...eventRoutes];
}
