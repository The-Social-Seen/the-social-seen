"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { EventCard } from "@/components/events/EventCard";
import type { EventWithStats } from "@/types";

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

interface UpcomingEventsSectionProps {
  events: EventWithStats[];
}

export function UpcomingEventsSection({ events }: UpcomingEventsSectionProps) {
  return (
    <section className="bg-bg-card px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 text-center"
        >
          <p className="mb-4 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
            Upcoming
          </p>
          <h2 className="mb-4 font-serif text-4xl font-bold text-text-primary md:text-5xl">
            What&apos;s Coming Up
          </h2>
          <p className="mx-auto max-w-xl font-sans text-lg text-text-secondary">
            From intimate supper clubs to gallery openings, there is always
            something worth getting dressed up for.
          </p>
        </motion.div>

        {/* Events grid */}
        <motion.div
          className="grid gap-8 md:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
        >
          {events.map((event) => (
            <motion.div key={event.id} variants={itemVariants}>
              <EventCard event={event} />
            </motion.div>
          ))}
        </motion.div>

        {/* View all link */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="mt-14 text-center"
        >
          <Link
            href="/events"
            className="group inline-flex items-center gap-2 font-sans text-sm font-semibold uppercase tracking-wider text-gold transition-colors hover:text-gold/80"
          >
            View All Events
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
