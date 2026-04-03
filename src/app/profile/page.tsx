"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Calendar,
  MapPin,
  Clock,
  Star,
  Edit3,
  Linkedin,
  CalendarCheck,
  CalendarClock,
  Users,
  Briefcase,
  Building2,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { members } from "@/data/members";
import { upcomingEvents, pastEvents } from "@/data/events";
import { format } from "date-fns";

/* ------------------------------------------------------------------ */
/*  Mock user = members[0] (Charlotte Moreau)                          */
/* ------------------------------------------------------------------ */

const user = members[0];

/* Mock booked upcoming events (first 3) */
const myUpcomingEvents = upcomingEvents.slice(0, 3);

/* Mock past events (first 3) */
const myPastEvents = pastEvents.slice(0, 3);

/* User has reviewed event 9 (Whisky) but not others */
const reviewedEventIds = ["9"];

/* Waitlisted event — the sold-out Jazz event (id: 5) */
const waitlistedEvent = upcomingEvents.find((e) => e.id === "5")!;

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-6 right-6 z-50 rounded-xl border border-gold/20 bg-charcoal px-6 py-4 font-sans text-sm text-cream shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <span>{message}</span>
        <button
          onClick={onClose}
          className="ml-2 text-cream/50 transition-colors hover:text-cream"
        >
          &times;
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab values                                                         */
/* ------------------------------------------------------------------ */

type TabValue = "upcoming" | "past" | "waitlisted";

/* ------------------------------------------------------------------ */
/*  Event card for profile                                             */
/* ------------------------------------------------------------------ */

function EventCard({
  event,
  variant = "upcoming",
  showReviewBtn = false,
  waitlistPosition,
  onReview,
}: {
  event: (typeof upcomingEvents)[number];
  variant?: "upcoming" | "past" | "waitlisted";
  showReviewBtn?: boolean;
  waitlistPosition?: number;
  onReview?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="group overflow-hidden rounded-2xl border border-charcoal/5 bg-white shadow-sm transition-all hover:shadow-md"
    >
      <div className="flex flex-col sm:flex-row">
        {/* Image */}
        <div className="relative h-48 w-full flex-shrink-0 overflow-hidden sm:h-auto sm:w-48">
          <Image
            src={event.imageUrl}
            alt={event.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {variant === "waitlisted" && waitlistPosition && (
            <div className="absolute left-3 top-3 rounded-full bg-gold px-3 py-1 font-sans text-xs font-bold text-charcoal">
              #{waitlistPosition} on waitlist
            </div>
          )}
          {variant === "past" && event.averageRating && (
            <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-charcoal/80 px-3 py-1 backdrop-blur-sm">
              <Star className="h-3 w-3 fill-gold text-gold" />
              <span className="font-sans text-xs font-medium text-white">
                {event.averageRating}
              </span>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex flex-1 flex-col justify-between p-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-gold/10 px-3 py-0.5 font-sans text-xs font-medium text-gold">
                {event.category}
              </span>
              {event.price === 0 ? (
                <span className="font-sans text-xs font-medium text-green-600">
                  Free
                </span>
              ) : (
                <span className="font-sans text-xs text-charcoal/40">
                  &pound;{event.price}
                </span>
              )}
            </div>
            <h3 className="mb-2 font-serif text-lg font-bold text-charcoal">
              {event.title}
            </h3>
            <div className="space-y-1">
              <p className="flex items-center gap-2 font-sans text-xs text-charcoal/50">
                <Calendar className="h-3.5 w-3.5" />
                {format(new Date(event.dateTime), "EEEE, d MMMM yyyy")}
              </p>
              <p className="flex items-center gap-2 font-sans text-xs text-charcoal/50">
                <Clock className="h-3.5 w-3.5" />
                {format(new Date(event.dateTime), "h:mm a")} &ndash;{" "}
                {format(new Date(event.endTime), "h:mm a")}
              </p>
              <p className="flex items-center gap-2 font-sans text-xs text-charcoal/50">
                <MapPin className="h-3.5 w-3.5" />
                {event.venueName}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center gap-3">
            <Link
              href={`/events/${event.slug}`}
              className="font-sans text-xs font-medium text-gold transition-colors hover:text-gold/80"
            >
              View Details
            </Link>
            {showReviewBtn && (
              <button
                onClick={onReview}
                className="rounded-full border border-gold/30 px-4 py-1.5 font-sans text-xs font-medium text-gold transition-all hover:bg-gold/10"
              >
                Leave a Review
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile Page                                                       */
/* ------------------------------------------------------------------ */

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<TabValue>("upcoming");
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const tabs: { value: TabValue; label: string; icon: React.ElementType; count: number }[] = [
    { value: "upcoming", label: "Upcoming Events", icon: CalendarClock, count: myUpcomingEvents.length },
    { value: "past", label: "Past Events", icon: CalendarCheck, count: myPastEvents.length },
    { value: "waitlisted", label: "Waitlisted", icon: Users, count: 1 },
  ];

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Back link */}
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 font-sans text-sm text-charcoal/40 transition-colors hover:text-charcoal"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        {/* ---- Hero Section ---- */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 overflow-hidden rounded-2xl border border-charcoal/5 bg-white p-8 shadow-sm md:p-10"
        >
          <div className="flex flex-col items-start gap-8 md:flex-row">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="h-28 w-28 overflow-hidden rounded-2xl border-4 border-gold/20 md:h-36 md:w-36">
                <Image
                  src={user.avatarUrl}
                  alt={user.name}
                  width={144}
                  height={144}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="absolute -bottom-2 -right-2 rounded-full bg-gold px-3 py-1 font-sans text-[10px] font-bold uppercase tracking-wider text-charcoal">
                Member
              </div>
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="font-serif text-3xl font-bold text-charcoal md:text-4xl">
                    {user.name}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1.5 font-sans text-sm text-charcoal/60">
                      <Briefcase className="h-3.5 w-3.5" />
                      {user.jobTitle}
                    </span>
                    <span className="text-charcoal/20">&bull;</span>
                    <span className="flex items-center gap-1.5 font-sans text-sm text-charcoal/60">
                      <Building2 className="h-3.5 w-3.5" />
                      {user.company}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => showToast("Edit mode coming soon")}
                  className="inline-flex items-center gap-2 rounded-full border border-charcoal/10 px-5 py-2 font-sans text-sm font-medium text-charcoal/60 transition-all hover:border-gold hover:text-gold"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit Profile
                </button>
              </div>

              {/* Bio */}
              <p className="mb-5 max-w-xl font-sans text-sm leading-relaxed text-charcoal/60">
                {user.bio}
              </p>

              {/* Stats row */}
              <div className="mb-5 flex flex-wrap items-center gap-6">
                <div className="text-center">
                  <p className="font-serif text-2xl font-bold text-charcoal">
                    {user.eventsAttended}
                  </p>
                  <p className="font-sans text-xs text-charcoal/40">Events Attended</p>
                </div>
                <div className="h-8 w-px bg-charcoal/10" />
                <div className="text-center">
                  <p className="font-serif text-2xl font-bold text-charcoal">
                    {user.interests.length}
                  </p>
                  <p className="font-sans text-xs text-charcoal/40">Interests</p>
                </div>
                <div className="h-8 w-px bg-charcoal/10" />
                <div className="text-center">
                  <p className="font-sans text-sm text-charcoal/60">
                    Member since{" "}
                    <span className="font-medium text-charcoal">
                      {format(new Date(user.joinedAt), "MMMM yyyy")}
                    </span>
                  </p>
                </div>
              </div>

              {/* Interests */}
              <div className="mb-4 flex flex-wrap gap-2">
                {user.interests.map((interest) => (
                  <span
                    key={interest}
                    className="rounded-full border border-gold/30 px-4 py-1.5 font-sans text-xs font-medium text-gold"
                  >
                    {interest}
                  </span>
                ))}
              </div>

              {/* Industry + LinkedIn */}
              <div className="flex flex-wrap items-center gap-4">
                <span className="rounded-full bg-blush/40 px-4 py-1.5 font-sans text-xs font-medium text-charcoal/60">
                  {user.industry}
                </span>
                {user.linkedinUrl && (
                  <a
                    href={user.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-sans text-xs text-charcoal/40 transition-colors hover:text-gold"
                  >
                    <Linkedin className="h-3.5 w-3.5" />
                    LinkedIn
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ---- Tabs ---- */}
        <div className="mb-8">
          <div className="flex gap-1 rounded-xl border border-charcoal/5 bg-white p-1.5 shadow-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 font-sans text-sm font-medium transition-all",
                    isActive
                      ? "bg-charcoal text-cream shadow-sm"
                      : "text-charcoal/40 hover:text-charcoal/70"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      isActive
                        ? "bg-gold/20 text-gold"
                        : "bg-charcoal/5 text-charcoal/30"
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- Tab Content ---- */}
        <div className="space-y-4">
          {activeTab === "upcoming" && (
            <>
              {myUpcomingEvents.length === 0 ? (
                <div className="rounded-2xl border border-charcoal/5 bg-white p-12 text-center">
                  <CalendarClock className="mx-auto mb-4 h-10 w-10 text-charcoal/20" />
                  <p className="font-sans text-sm text-charcoal/40">
                    No upcoming events booked yet.
                  </p>
                  <Link
                    href="/events"
                    className="mt-4 inline-block font-sans text-sm font-medium text-gold"
                  >
                    Browse events
                  </Link>
                </div>
              ) : (
                myUpcomingEvents.map((event) => (
                  <EventCard key={event.id} event={event} variant="upcoming" />
                ))
              )}
            </>
          )}

          {activeTab === "past" && (
            <>
              {myPastEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  variant="past"
                  showReviewBtn={!reviewedEventIds.includes(event.id)}
                  onReview={() =>
                    showToast(`Review form for "${event.title}" coming soon`)
                  }
                />
              ))}
            </>
          )}

          {activeTab === "waitlisted" && waitlistedEvent && (
            <EventCard
              event={waitlistedEvent}
              variant="waitlisted"
              waitlistPosition={3}
            />
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
