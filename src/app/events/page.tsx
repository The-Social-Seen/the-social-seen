import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getPublishedEvents } from "@/lib/supabase/queries/events";
import { canonicalUrl } from "@/lib/utils/site";
import {
  PRIMARY_ELIGIBLE_TAG_SLUGS,
  primarySlugForLegacyCategory,
} from "@/lib/constants/tags";
import EventsPageClient from "@/components/events/EventsPageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Events — The Social Seen",
  description:
    "Discover curated experiences designed to inspire, connect, and delight. From intimate dinners to cultural excursions, find your next unforgettable evening.",
  alternates: { canonical: canonicalUrl("/events") },
};

interface EventsPageProps {
  // Next.js 15: searchParams is async.
  searchParams: Promise<{
    tag?: string | string[];
    category?: string | string[];
  }>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const resolved = await searchParams;
  const tagParam = firstParam(resolved.tag);
  const categoryParam = firstParam(resolved.category);

  // F1a soft fallback — old shared links use `?category=<enum>`. Map to
  // the canonical primary slug and redirect so the URL bar reflects the
  // new param shape. If both are present, `?tag=` wins (it's the future)
  // and `?category=` is dropped silently.
  if (categoryParam && !tagParam) {
    const fallbackSlug = primarySlugForLegacyCategory(categoryParam);
    if (fallbackSlug) {
      redirect(`/events?tag=${encodeURIComponent(fallbackSlug)}`);
    }
    // Unknown category value: drop it. Falls through to "All".
  }

  // Validate the tag slug — if it's not one of the 15 primary-eligible
  // slugs, treat as "All" rather than rendering an empty list.
  const initialTag =
    tagParam && PRIMARY_ELIGIBLE_TAG_SLUGS.has(tagParam) ? tagParam : null;

  const events = await getPublishedEvents();

  return (
    <main className="min-h-screen bg-bg-primary">
      {/* Header — pt-16/pt-20 clears the fixed nav header */}
      <section className="border-b border-blush/40 bg-bg-card pt-16 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6 py-12 md:py-16">
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
            Upcoming Events
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-primary/60">
            Discover curated experiences designed to inspire, connect, and
            delight. From intimate dinners to cultural excursions, find your next
            unforgettable evening.
          </p>
          <Link
            href="/events/past"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:underline underline-offset-2"
          >
            See past events
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <EventsPageClient events={events} initialTag={initialTag} />
    </main>
  );
}
