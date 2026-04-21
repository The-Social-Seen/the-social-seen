"use client";

import { useState, useTransition, forwardRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Calendar,
  MapPin,
  Users,
  Check,
  CalendarPlus,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { formatDateFull, formatTimeRange } from "@/lib/utils/dates";
import { formatPrice } from "@/lib/utils/currency";
import { downloadIcsFile } from "@/lib/utils/calendar";
import {
  cancelBooking,
  claimWaitlistSpot,
  leaveWaitlist,
} from "@/app/events/[slug]/actions";
import StarRating from "@/components/reviews/StarRating";
import type { EventDetail, Booking } from "@/types";

interface BookingSidebarProps {
  event: EventDetail;
  userBooking: Booking | null;
  isPast: boolean;
  isLoggedIn: boolean;
  userName: string | null;
  onBookClick: () => void;
}

const BookingSidebar = forwardRef<HTMLDivElement, BookingSidebarProps>(
  function BookingSidebar(
    { event, userBooking, isPast, isLoggedIn, userName, onBookClick },
    ref
  ) {
    const isFree = event.price === 0;
    const isSoldOut =
      !isPast && event.spots_left !== null && event.spots_left === 0;
    const isCancelled = event.is_cancelled;

    return (
      <div className="lg:w-1/3">
        <div className="sticky top-8" ref={ref}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="overflow-hidden rounded-2xl border border-blush/40 bg-bg-card shadow-lg shadow-charcoal/5"
          >
            <div className="p-6">
              {/* Cancelled state */}
              {isCancelled ? (
                <CancelledState />
              ) : isPast ? (
                <PastState event={event} />
              ) : userBooking?.status === "confirmed" ? (
                <ConfirmedState
                  event={event}
                  booking={userBooking}
                  userName={userName}
                />
              ) : userBooking?.status === "waitlisted" ? (
                <WaitlistedState event={event} booking={userBooking} />
              ) : isLoggedIn ? (
                <BookableState
                  event={event}
                  isFree={isFree}
                  isSoldOut={isSoldOut}
                  onBookClick={onBookClick}
                />
              ) : (
                <LoggedOutState
                  event={event}
                  isFree={isFree}
                  isSoldOut={isSoldOut}
                />
              )}
            </div>
          </motion.div>
        </div>
      </div>
    );
  }
);

export default BookingSidebar;

function buildMapsUrl(event: EventDetail): string {
  const query = [event.venue_name, event.venue_address, event.postcode]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ── Shared info block ─────────────────────────────────────────────────────────

function EventInfoBlock({ event }: { event: EventDetail }) {
  const isFree = event.price === 0;

  return (
    <>
      {/* Price */}
      <div className="mb-6">
        {isFree ? (
          <span className="text-3xl font-bold text-success">Free</span>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-gold">
              {formatPrice(event.price)}
            </span>
            <span className="text-sm text-text-primary/50">per person</span>
          </div>
        )}
      </div>

      {/* Date & Venue */}
      <div className="mb-4 space-y-3">
        <div className="flex items-start gap-3">
          <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {formatDateFull(event.date_time)}
            </p>
            <p className="text-sm text-text-primary/50">
              {formatTimeRange(event.date_time, event.end_time)}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
          {event.venue_revealed ? (
            <div>
              <p className="text-sm font-semibold text-text-primary">
                {event.venue_name}
              </p>
              <p className="text-sm text-text-primary/50">
                {event.venue_address}
                {event.postcode ? `, ${event.postcode}` : ""}
              </p>
              <a
                href={buildMapsUrl(event)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs font-medium text-gold hover:text-gold-dark"
              >
                Get directions
              </a>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-text-primary">
                Venue revealed 1 week before
              </p>
              <p className="text-sm text-text-primary/50">
                We&rsquo;ll email you the address closer to the date.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Attendees */}
      <div className="mb-6 flex items-center gap-3 rounded-xl bg-bg-primary p-3">
        <Users className="h-4 w-4 text-gold" />
        <span className="text-sm text-text-primary/70">
          {event.confirmed_count} people going
        </span>
      </div>
    </>
  );
}

function CapacitySection({ event }: { event: EventDetail }) {
  if (event.spots_left !== null && event.spots_left > 0) {
    return (
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-text-primary/60">Spots remaining</span>
          <span className="font-semibold text-text-primary">
            {event.spots_left} / {event.capacity}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-bg-secondary">
          <div
            className="h-full rounded-full bg-gold transition-all"
            style={{
              width: `${
                event.capacity
                  ? ((event.capacity - event.spots_left) / event.capacity) * 100
                  : 0
              }%`,
            }}
          />
        </div>
        {event.spots_left <= 5 && (
          <p className="mt-2 text-xs font-medium text-gold">
            Only {event.spots_left} spots left — book soon!
          </p>
        )}
      </div>
    );
  }

  if (event.spots_left === 0) {
    return (
      <div className="mb-6 rounded-xl border border-gold/20 bg-gold/5 p-4 text-center">
        <p className="text-sm font-semibold text-text-primary">
          This event is fully booked — join the waitlist
        </p>
        <p className="mt-1 text-xs text-text-primary/60">
          Most waitlisted members get a spot — we&apos;ll let you know the
          moment one opens
        </p>
      </div>
    );
  }

  return null; // unlimited capacity
}

// ── State: Logged out ─────────────────────────────────────────────────────────

function LoggedOutState({
  event,
  isFree,
  isSoldOut,
}: {
  event: EventDetail;
  isFree: boolean;
  isSoldOut: boolean;
}) {
  return (
    <>
      <EventInfoBlock event={event} />
      <CapacitySection event={event} />
      <Link
        href={`/login?redirect=/events/${event.slug}`}
        className="block w-full rounded-2xl bg-gold py-4 text-center text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark hover:shadow-xl hover:shadow-gold/30 active:scale-[0.98]"
      >
        Sign In to Book
      </Link>
      <p className="mt-3 text-center text-sm text-text-primary/50">
        Not a member yet?{" "}
        <Link href="/join" className="font-medium text-gold hover:text-gold-dark">
          Join now
        </Link>
      </p>
    </>
  );
}

// ── State: Logged in, bookable ────────────────────────────────────────────────

function BookableState({
  event,
  isFree,
  isSoldOut,
  onBookClick,
}: {
  event: EventDetail;
  isFree: boolean;
  isSoldOut: boolean;
  onBookClick: () => void;
}) {
  return (
    <>
      <EventInfoBlock event={event} />
      <CapacitySection event={event} />
      <button
        onClick={onBookClick}
        className="w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark hover:shadow-xl hover:shadow-gold/30 active:scale-[0.98]"
      >
        {isSoldOut ? "Join Waitlist" : isFree ? "RSVP Now" : "Book Now"}
      </button>
    </>
  );
}

// ── State: Confirmed booking ──────────────────────────────────────────────────

function ConfirmedState({
  event,
  booking,
  userName,
}: {
  event: EventDetail;
  booking: Booking;
  userName: string | null;
}) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [cancelError, setCancelError] = useState<string | null>(null);

  // 48h refund policy preview — same cut-off as server-side constant.
  // Captured at mount via useState's lazy initializer: runs once,
  // doesn't re-read Date.now() on every render, and satisfies the
  // "no impure calls in render" lint rule. The value is stable enough
  // for the lifetime of the sidebar — no one keeps it open long
  // enough for the window to cross 48h mid-session.
  const isPaid = event.price > 0;
  const [refundEligible] = useState(() => {
    if (!isPaid) return false;
    const hoursUntilEvent =
      (new Date(event.date_time).getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntilEvent > 48;
  });

  function handleCancel() {
    setCancelError(null);
    startTransition(async () => {
      const result = await cancelBooking(booking.id);
      if (!result.success) {
        setCancelError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      // Success — full refresh so the sidebar re-renders in the
      // LoggedOutState/BookableState and the cancellation is reflected
      // in the bookings list. The refund (if any) was already issued
      // server-side.
      window.location.reload();
    });
  }

  return (
    <>
      {/* Confirmed badge */}
      <div className="mb-5 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10">
          <Check className="h-4 w-4 text-success" />
        </div>
        <span className="text-lg font-semibold text-text-primary">
          You&apos;re going!
        </span>
      </div>

      {/* Compact event info */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-text-primary/60">
          <Calendar className="h-3.5 w-3.5 text-gold" />
          <span>{formatDateFull(event.date_time)}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-text-primary/60">
          <MapPin className="h-3.5 w-3.5 text-gold" />
          <span>
            {event.venue_revealed
              ? event.venue_name
              : "Venue revealed 1 week before"}
          </span>
        </div>
      </div>

      {/* Add to Calendar */}
      <button
        onClick={() =>
          downloadIcsFile({
            title: event.title,
            dateTime: event.date_time,
            endTime: event.end_time,
            venueName: event.venue_name,
            venueAddress: event.venue_address,
            shortDescription: event.short_description,
            slug: event.slug,
          })
        }
        className="mb-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-blush/60 py-3 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
      >
        <CalendarPlus className="h-4 w-4" />
        Add to Calendar
      </button>

      {/* Cancel section */}
      <div className="border-t border-blush/40 pt-4">
        {!showCancelConfirm ? (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="text-sm text-text-primary/50 transition-colors hover:text-text-primary"
          >
            Need to cancel?
          </button>
        ) : (
          <div>
            <p className="mb-2 text-sm text-text-primary/70">
              Are you sure? This will release your spot.
            </p>
            {isPaid && (
              <p className="mb-3 text-xs text-text-primary/60">
                {refundEligible
                  ? `We\u2019ll refund ${formatPrice(booking.price_at_booking)} to your card (2\u20133 working days).`
                  : "Cancellations within 48h of the event aren\u2019t refundable."}
              </p>
            )}
            {cancelError && (
              <p className="mb-3 text-xs text-danger">{cancelError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={isPending}
                className="flex-1 rounded-xl py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50"
              >
                {isPending ? "Cancelling…" : "Yes, Cancel"}
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 rounded-xl py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/5"
              >
                Keep My Spot
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── State: Waitlisted ─────────────────────────────────────────────────────────

function WaitlistedState({
  event,
  booking,
}: {
  event: EventDetail;
  booking: Booking;
}) {
  const searchParams = useSearchParams();
  const isClaiming = searchParams.get("claim") === "1";

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isFree = event.price === 0;

  function handleLeave() {
    startTransition(async () => {
      const result = await leaveWaitlist(booking.id);
      if (!result.success) {
        setShowLeaveConfirm(false);
      }
    });
  }

  function handleClaim() {
    setClaimError(null);
    startTransition(async () => {
      const result = await claimWaitlistSpot(event.id);
      if (!result.success) {
        setClaimError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      // Paid event: redirect to Stripe Checkout.
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      // Free event — booking is already confirmed. Full refresh so the
      // whole sidebar re-renders in the ConfirmedState.
      window.location.reload();
    });
  }

  return (
    <>
      {/* Waitlist badge */}
      <div className="mb-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1 text-sm font-semibold text-gold">
          Waitlisted
        </span>
      </div>

      {/* Claim banner — shown when ?claim=1 (arrived via spot-available email) */}
      {isClaiming && (
        <div className="mb-5 rounded-xl border border-gold/40 bg-gold/5 p-4">
          <p className="mb-1 text-sm font-semibold text-text-primary">
            A spot just opened!
          </p>
          <p className="mb-3 text-xs text-text-primary/70">
            First to {isFree ? "claim" : "pay"} wins. You&rsquo;re still on the
            waitlist if someone beats you to it.
          </p>
          {claimError && (
            <p className="mb-3 text-xs text-danger">{claimError}</p>
          )}
          <button
            onClick={handleClaim}
            disabled={isPending}
            className="block w-full rounded-full bg-gold py-3 text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark hover:shadow-xl hover:shadow-gold/30 active:scale-[0.98] disabled:opacity-60"
          >
            {isPending
              ? isFree
                ? "Claiming\u2026"
                : "Redirecting to payment\u2026"
              : isFree
              ? "Claim your spot"
              : `Claim spot (${formatPrice(event.price)})`}
          </button>
        </div>
      )}

      <p className="mb-1 text-lg font-semibold text-text-primary">
        You&apos;re{" "}
        <span className="text-gold">#{booking.waitlist_position}</span> on the
        waitlist
      </p>
      <p className="mb-5 text-sm text-text-primary/60">
        {isClaiming
          ? "Not ready now? You\u2019ll stay on the waitlist for the next opening."
          : "We\u2019ll email you if a spot opens up."}
      </p>

      {/* Leave section */}
      <div className="border-t border-blush/40 pt-4">
        {!showLeaveConfirm ? (
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="text-sm text-text-primary/50 transition-colors hover:text-text-primary"
          >
            Leave waitlist
          </button>
        ) : (
          <div>
            <p className="mb-3 text-sm text-text-primary/70">
              Leave the waitlist for this event?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleLeave}
                disabled={isPending}
                className="flex-1 rounded-xl py-2 text-sm font-medium text-text-primary/60 transition-colors hover:bg-bg-primary disabled:opacity-50"
              >
                {isPending ? "Leaving…" : "Yes, Leave"}
              </button>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 rounded-xl py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/5"
              >
                Stay on Waitlist
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── State: Past event ─────────────────────────────────────────────────────────

function PastState({ event }: { event: EventDetail }) {
  return (
    <div className="rounded-xl bg-bg-primary p-4 text-center">
      <p className="text-sm font-medium text-text-primary/50">
        This event has ended
      </p>
      {event.avg_rating > 0 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <StarRating rating={event.avg_rating} size="sm" />
          <span className="text-sm font-semibold text-text-primary">
            {event.avg_rating.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── State: Event cancelled ────────────────────────────────────────────────────

function CancelledState() {
  return (
    <>
      <div className="mb-4 rounded-xl border border-danger/20 bg-danger/5 p-4 text-center">
        <p className="text-sm font-semibold text-text-primary">
          This event has been cancelled
        </p>
        <p className="mt-1 text-xs text-text-primary/60">
          If you had a booking, it has been automatically cancelled.
        </p>
      </div>
      <Link
        href="/events"
        className="block text-center text-sm font-medium text-gold transition-colors hover:text-gold-dark"
      >
        Browse upcoming events →
      </Link>
    </>
  );
}
