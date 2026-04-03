"use client";

import { useState, useMemo } from "react";
import { events, upcomingEvents, pastEvents } from "@/data/events";
import { EventCategory } from "@/types";
import EventCard from "@/components/events/EventCard";
import { cn } from "@/lib/utils/cn";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

const categories: ("All" | EventCategory)[] = [
  "All",
  "drinks",
  "dining",
  "cultural",
  "wellness",
  "sport",
  "workshops",
  "music",
  "networking",
];

const priceFilters = ["All", "Free", "Paid"] as const;
type PriceFilter = (typeof priceFilters)[number];

export default function EventsPage() {
  const [selectedCategory, setSelectedCategory] = useState<
    "All" | EventCategory
  >("All");
  const [selectedPrice, setSelectedPrice] = useState<PriceFilter>("All");
  const [pastExpanded, setPastExpanded] = useState(false);

  const filteredUpcoming = useMemo(() => {
    return upcomingEvents.filter((event) => {
      const categoryMatch =
        selectedCategory === "All" || event.category === selectedCategory;
      const priceMatch =
        selectedPrice === "All" ||
        (selectedPrice === "Free" && event.price === 0) ||
        (selectedPrice === "Paid" && event.price > 0);
      return categoryMatch && priceMatch;
    });
  }, [selectedCategory, selectedPrice]);

  const filteredPast = useMemo(() => {
    return pastEvents.filter((event) => {
      const categoryMatch =
        selectedCategory === "All" || event.category === selectedCategory;
      const priceMatch =
        selectedPrice === "All" ||
        (selectedPrice === "Free" && event.price === 0) ||
        (selectedPrice === "Paid" && event.price > 0);
      return categoryMatch && priceMatch;
    });
  }, [selectedCategory, selectedPrice]);

  return (
    <main className="min-h-screen bg-bg-primary">
      {/* Header */}
      <section className="border-b border-blush/40 bg-bg-card">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
              Upcoming Events
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-text-primary/60">
              Discover curated experiences designed to inspire, connect, and
              delight. From intimate dinners to cultural excursions, find your
              next unforgettable evening.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Filter Bar */}
      <section className="sticky top-0 z-20 border-b border-blush/40 bg-bg-card/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Category Pills */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="mr-1 hidden h-4 w-4 text-text-primary/40 md:block" />
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={cn(
                      "flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                      selectedCategory === category
                        ? "bg-charcoal text-white shadow-sm"
                        : "bg-bg-primary text-text-primary/70 hover:bg-blush/40 hover:text-text-primary"
                    )}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {/* Price Filter */}
            <div className="flex items-center gap-2">
              {priceFilters.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setSelectedPrice(filter)}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                    selectedPrice === filter
                      ? "bg-gold text-white shadow-sm"
                      : "bg-bg-primary text-text-primary/70 hover:bg-blush/40 hover:text-text-primary"
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
              <p className="text-lg text-text-primary/50">
                No upcoming events match your filters.
              </p>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setSelectedPrice("All");
                }}
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
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </main>
  );
}
