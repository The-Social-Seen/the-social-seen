"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PRIMARY_TAG_LABELS } from "@/lib/constants/tags";
import type { EventWithStats } from "@/types";
import { isPastEvent } from "@/lib/utils/dates";
import EventCard from "@/components/events/EventCard";
import { cn } from "@/lib/utils/cn";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, SlidersHorizontal, CalendarX } from "lucide-react";

// F1a: filter chips now mirror the 15 primary-eligible tags (sharper
// taxonomy — "Theatre & Comedy" instead of "Cultural", etc.) rather
// than the 9 legacy event_category enum values. URL param is `?tag=<slug>`.
// The events/page.tsx server component handles the `?category=` →
// `?tag=` soft-fallback redirect for old shared links.

const TAG_OPTIONS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "all", label: "All" },
  ...PRIMARY_TAG_LABELS,
];

const priceFilters = ["All", "Free", "Paid"] as const;
type PriceFilter = (typeof priceFilters)[number];

interface EventsPageClientProps {
  events: EventWithStats[];
  /**
   * Initial tag slug from the URL (`?tag=<slug>`). `null` = "All".
   * Soft-fallback `?category=` is normalised at the page layer before it
   * reaches this component.
   */
  initialTag?: string | null;
}

export default function EventsPageClient({
  events,
  initialTag = null,
}: EventsPageClientProps) {
  const router = useRouter();
  const [selectedTagSlug, setSelectedTagSlug] = useState<string | null>(
    initialTag,
  );
  const [selectedPrice, setSelectedPrice] = useState<PriceFilter>("All");
  const [pastExpanded, setPastExpanded] = useState(false);

  const handleTagClick = useCallback(
    (slug: string | null) => {
      setSelectedTagSlug(slug);
      // Keep URL in sync so filter is shareable + survives reload.
      // scroll: false to avoid jumping back to the top on every chip click.
      const target = slug ? `/events?tag=${encodeURIComponent(slug)}` : "/events";
      router.replace(target, { scroll: false });
    },
    [router],
  );

  const { upcoming, past } = useMemo(() => {
    const upcomingList: EventWithStats[] = [];
    const pastList: EventWithStats[] = [];

    for (const event of events) {
      if (isPastEvent(event.date_time)) {
        pastList.push(event);
      } else {
        upcomingList.push(event);
      }
    }

    return { upcoming: upcomingList, past: pastList };
  }, [events]);

  const tagMatches = useCallback(
    (event: EventWithStats) =>
      selectedTagSlug === null || event.primary_tag.slug === selectedTagSlug,
    [selectedTagSlug],
  );

  const priceMatches = useCallback(
    (event: EventWithStats) =>
      selectedPrice === "All" ||
      (selectedPrice === "Free" && event.price === 0) ||
      (selectedPrice === "Paid" && event.price > 0),
    [selectedPrice],
  );

  const filteredUpcoming = useMemo(
    () => upcoming.filter((e) => tagMatches(e) && priceMatches(e)),
    [upcoming, tagMatches, priceMatches],
  );

  const filteredPast = useMemo(
    () => past.filter((e) => tagMatches(e) && priceMatches(e)),
    [past, tagMatches, priceMatches],
  );

  const clearFilters = () => {
    handleTagClick(null);
    setSelectedPrice("All");
  };

  return (
    <>
      {/* Filter Bar — sticky below fixed header */}
      <section className="sticky top-16 z-20 border-b border-blush/40 bg-bg-card/80 backdrop-blur-xl sm:top-20">
        <div className="mx-auto max-w-7xl px-6 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {/* Tag pills — 15 primary-eligible tags + All */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="mr-1 hidden h-4 w-4 text-text-primary/40 md:block" />
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                {TAG_OPTIONS.map((option) => {
                  const isAll = option.slug === "all";
                  const isActive = isAll
                    ? selectedTagSlug === null
                    : selectedTagSlug === option.slug;
                  return (
                    <button
                      key={option.slug}
                      onClick={() => handleTagClick(isAll ? null : option.slug)}
                      className={cn(
                        "flex min-h-[44px] flex-shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-charcoal text-white shadow-sm"
                          : "bg-bg-primary text-text-primary/70 hover:bg-blush/40 hover:text-text-primary",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Price Filter */}
            <div className="flex items-center gap-2">
              {priceFilters.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setSelectedPrice(filter)}
                  className={cn(
                    "flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium transition-all duration-200",
                    selectedPrice === filter
                      ? "bg-gold text-white shadow-sm"
                      : "bg-bg-primary text-text-primary/70 hover:bg-blush/40 hover:text-text-primary",
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Upcoming Events Grid */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <AnimatePresence mode="popLayout">
          {filteredUpcoming.length > 0 ? (
            <motion.div
              layout
              className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
            >
              <AnimatePresence mode="popLayout">
                {filteredUpcoming.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-20 text-center"
            >
              <CalendarX className="mx-auto mb-4 h-10 w-10 text-text-tertiary/40" />
              <p className="text-lg font-medium text-text-primary">
                No upcoming events match your filters.
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                Try adjusting your filters or check back soon for new events.
              </p>
              <button
                onClick={clearFilters}
                className="mt-4 text-sm font-medium text-gold underline underline-offset-4 transition-colors hover:text-text-primary"
              >
                Clear all filters
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Past Events Accordion */}
      <section className="border-t border-blush/40">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <button
            onClick={() => setPastExpanded(!pastExpanded)}
            className="group flex w-full items-center justify-between py-4"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-text-primary">
                Past Events
              </h2>
              <span className="rounded-full bg-blush/50 px-3 py-0.5 text-sm font-medium text-text-primary/60">
                {filteredPast.length}
              </span>
            </div>
            <motion.div
              animate={{ rotate: pastExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="h-6 w-6 text-text-primary/40 transition-colors group-hover:text-gold" />
            </motion.div>
          </button>

          <AnimatePresence initial={false}>
            {pastExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                {filteredPast.length > 0 ? (
                  <div className="grid grid-cols-1 gap-6 pt-4 pb-8 md:grid-cols-2 lg:grid-cols-3">
                    {filteredPast.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        showRating
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <p className="text-text-primary/50">
                      No past events match your filters.
                    </p>
                    <button
                      onClick={clearFilters}
                      className="mt-4 text-sm font-medium text-gold underline underline-offset-4 transition-colors hover:text-text-primary"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </>
  );
}
