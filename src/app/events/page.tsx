import { getPublishedEvents } from "@/lib/supabase/queries/events";
import EventsPageClient from "@/components/events/EventsPageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Events | The Social Seen",
  description:
    "Discover curated experiences designed to inspire, connect, and delight. From intimate dinners to cultural excursions, find your next unforgettable evening.",
};

export default async function EventsPage() {
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
        </div>
      </section>

      <EventsPageClient events={events} />
    </main>
  );
}
