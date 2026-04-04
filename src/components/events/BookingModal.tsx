"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Calendar,
  MapPin,
  CreditCard,
  Lock,
  Share2,
  CalendarPlus,
  AlertTriangle,
  Info,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { formatDateModal, formatTime } from "@/lib/utils/dates";
import { formatPrice } from "@/lib/utils/currency";
import { downloadIcsFile } from "@/lib/utils/calendar";
import { createBooking } from "@/app/events/[slug]/actions";
import type { EventDetail, BookingStatus } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface BookingModalProps {
  event: EventDetail;
  isOpen: boolean;
  onClose: () => void;
  userName: string | null;
}

interface BookingResult {
  bookingId: string;
  status: BookingStatus;
  waitlistPosition: number | null;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function BookingModal({
  event,
  isOpen,
  onClose,
  userName,
}: BookingModalProps) {
  const isFree = event.price === 0;
  const totalSteps = isFree ? 2 : 3;

  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Detect mobile for bottom sheet vs centered modal
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleClose = useCallback(() => {
    setStep(1);
    setError(null);
    setBookingResult(null);
    onClose();
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleClose]);

  // Submit booking via Server Action
  function handleBook() {
    setError(null);
    startTransition(async () => {
      const result = await createBooking(event.id);
      if (!result.success) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      setBookingResult({
        bookingId: result.bookingId!,
        status: result.status!,
        waitlistPosition: result.waitlistPosition ?? null,
      });
      // Advance to success step
      setStep(totalSteps);
    });
  }

  // Determine which step triggers booking
  const isLastStepBeforeSuccess = isFree ? step === 1 : step === 2;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal / Bottom Sheet */}
          <motion.div
            initial={
              isMobile
                ? { y: "100%", opacity: 1 }
                : { opacity: 0, scale: 0.95, y: 20 }
            }
            animate={
              isMobile ? { y: 0, opacity: 1 } : { opacity: 1, scale: 1, y: 0 }
            }
            exit={
              isMobile
                ? { y: "100%", opacity: 1 }
                : { opacity: 0, scale: 0.95, y: 20 }
            }
            transition={
              isMobile
                ? { duration: 0.3, ease: "easeOut" }
                : { type: "spring", damping: 25, stiffness: 300 }
            }
            className={cn(
              "relative z-10 w-full overflow-hidden bg-bg-card shadow-2xl",
              isMobile
                ? "max-h-[85vh] overflow-y-auto rounded-t-2xl"
                : "max-w-md rounded-3xl"
            )}
            style={
              isMobile
                ? { paddingBottom: "env(safe-area-inset-bottom)" }
                : undefined
            }
          >
            {/* Drag handle (mobile only) */}
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-border-light" />
              </div>
            )}

            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-20 rounded-full bg-bg-primary p-2 transition-colors hover:bg-blush/50"
              aria-label="Close booking modal"
            >
              <X className="h-4 w-4 text-text-primary" />
            </button>

            {/* Progress bar */}
            <div className="flex gap-1.5 px-6 pt-5" data-testid="progress-bar">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-all duration-300",
                    i < step
                      ? "bg-gold"
                      : i === step - 1
                        ? "bg-charcoal"
                        : "bg-blush/50"
                  )}
                />
              ))}
            </div>

            {/* Steps */}
            <div className="p-6">
              <AnimatePresence mode="wait">
                {step === 1 && (
                  <ConfirmStep
                    key="confirm"
                    event={event}
                    isFree={isFree}
                    error={error}
                    isPending={isPending}
                    onSubmit={isFree ? handleBook : () => setStep(2)}
                  />
                )}

                {step === 2 && !isFree && (
                  <PaymentStep
                    key="payment"
                    event={event}
                    error={error}
                    isPending={isPending}
                    onBack={() => {
                      setError(null);
                      setStep(1);
                    }}
                    onSubmit={handleBook}
                  />
                )}

                {step === totalSteps && bookingResult && (
                  <TicketCard
                    key="ticket"
                    event={event}
                    result={bookingResult}
                    userName={userName}
                    onClose={handleClose}
                  />
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Step 1: Confirm ──────────────────────────────────────────────────────────

function ConfirmStep({
  event,
  isFree,
  error,
  isPending,
  onSubmit,
}: {
  event: EventDetail;
  isFree: boolean;
  error: string | null;
  isPending: boolean;
  onSubmit: () => void;
}) {
  const [showRequirements, setShowRequirements] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h3 className="mb-1 font-serif text-xl font-bold text-text-primary">
        Confirm Details
      </h3>
      <p className="mb-6 text-sm text-text-primary/60">
        Review your booking before confirming
      </p>

      {/* Event summary card */}
      <div className="mb-6 space-y-4 rounded-2xl bg-bg-primary p-5">
        <div>
          <p className="font-semibold text-text-primary">{event.title}</p>
          <div className="mt-2 flex items-center gap-2 text-sm text-text-primary/60">
            <Calendar className="h-3.5 w-3.5 text-gold" />
            <span>{formatDateModal(event.date_time)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-text-primary/60">
            <MapPin className="h-3.5 w-3.5 text-gold" />
            <span>{event.venue_name}</span>
          </div>
        </div>

        <div className="border-t border-blush/40 pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-primary/60">
              1 spot × {isFree ? "Free" : formatPrice(event.price)}
            </span>
            <span className="font-semibold text-text-primary">
              {isFree ? "Free" : formatPrice(event.price)}
            </span>
          </div>
        </div>
      </div>

      {/* Special requirements (collapsible) */}
      <div className="mb-6">
        <button
          onClick={() => setShowRequirements(!showRequirements)}
          className="flex items-center gap-1 text-sm text-text-primary/50 transition-colors hover:text-text-primary"
        >
          Special requirements
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              showRequirements && "rotate-180"
            )}
          />
        </button>
        {showRequirements && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <textarea
              placeholder="Dietary needs, accessibility, etc."
              rows={3}
              className="mt-2 w-full rounded-xl border border-blush/60 bg-bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-primary/30 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20"
            />
          </motion.div>
        )}
      </div>

      {/* Error alert */}
      {error && <ErrorAlert message={error} />}

      {/* CTA */}
      <button
        onClick={onSubmit}
        disabled={isPending}
        className="w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white transition-all hover:bg-gold-dark active:scale-[0.98] disabled:opacity-60"
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reserving…
          </span>
        ) : isFree ? (
          "Reserve My Spot"
        ) : (
          "Continue to Payment"
        )}
      </button>
    </motion.div>
  );
}

// ── Step 2: Payment (paid events only) ───────────────────────────────────────

function PaymentStep({
  event,
  error,
  isPending,
  onBack,
  onSubmit,
}: {
  event: EventDetail;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h3 className="mb-1 font-serif text-xl font-bold text-text-primary">
        Payment
      </h3>
      <p className="mb-6 text-sm text-text-primary/60">
        Complete your booking securely
      </p>

      {/* Demo mode banner */}
      <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-300" />
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Demo mode — no real charges will be made to this card
        </p>
      </div>

      {/* Card inputs (disabled, pre-filled) */}
      <div className="mb-6 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-text-primary">
            Card number
          </label>
          <div className="flex items-center rounded-xl border border-blush/60 bg-bg-primary px-4 py-3">
            <CreditCard className="mr-3 h-4 w-4 text-text-primary/40" />
            <input
              type="text"
              disabled
              value="4242 4242 4242 4242"
              className="w-full bg-transparent text-sm text-text-primary/80 opacity-80"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-text-primary">
              Expiry
            </label>
            <input
              type="text"
              disabled
              value="12 / 28"
              className="w-full rounded-xl border border-blush/60 bg-bg-primary px-4 py-3 text-sm text-text-primary/80 opacity-80"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-text-primary">
              CVC
            </label>
            <input
              type="text"
              disabled
              value="123"
              className="w-full rounded-xl border border-blush/60 bg-bg-primary px-4 py-3 text-sm text-text-primary/80 opacity-80"
            />
          </div>
        </div>
      </div>

      {/* Total */}
      <div className="mb-6 rounded-xl bg-bg-primary p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-primary/60">Total</span>
          <span className="text-lg font-bold text-text-primary">
            {formatPrice(event.price)}
          </span>
        </div>
      </div>

      {/* Error alert */}
      {error && <ErrorAlert message={error} />}

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 rounded-2xl border border-blush/60 py-4 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={isPending}
          className="flex-[2] rounded-2xl bg-charcoal py-4 text-sm font-semibold text-white transition-all hover:bg-charcoal/90 active:scale-[0.98] disabled:opacity-60"
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              Pay {formatPrice(event.price)}
            </span>
          )}
        </button>
      </div>

      {/* Stripe footer */}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-text-primary/40">
        <Lock className="h-3 w-3" />
        Powered by Stripe
      </p>
    </motion.div>
  );
}

// ── Ticket Card (confirmation) ───────────────────────────────────────────────

function TicketCard({
  event,
  result,
  userName,
  onClose,
}: {
  event: EventDetail;
  result: BookingResult;
  userName: string | null;
  onClose: () => void;
}) {
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const isWaitlisted = result.status === "waitlisted";

  function handleCalendar() {
    downloadIcsFile({
      title: event.title,
      dateTime: event.date_time,
      endTime: event.end_time,
      venueName: event.venue_name,
      venueAddress: event.venue_address,
      shortDescription: event.short_description,
      slug: event.slug,
    });
    setCalendarAdded(true);
    setTimeout(() => setCalendarAdded(false), 2000);
  }

  async function handleShare() {
    const shareUrl = `${window.location.origin}/events/${event.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: event.title,
          text: `Join me at ${event.title}!`,
          url: shareUrl,
        });
      } catch {
        // User cancelled share — ignore
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  // Compute "arrive by" time (15 min before event start)
  const arriveByTime = formatTime(
    new Date(new Date(event.date_time).getTime() - 15 * 60 * 1000)
  );

  return (
    <motion.div
      key="ticket"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, type: "spring" }}
    >
      {/* Ticket card with shimmer */}
      <div className="relative overflow-hidden rounded-2xl border border-blush/40 bg-bg-card p-6">
        {/* Gold shimmer overlay */}
        <motion.div
          className="pointer-events-none absolute inset-0"
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{ duration: 1.5, ease: "easeInOut", delay: 0.2 }}
          style={{
            background:
              "linear-gradient(135deg, transparent 0%, rgba(201,169,110,0.1) 50%, transparent 100%)",
          }}
        />

        {/* Brand name */}
        <p className="mb-4 text-xs font-medium tracking-widest text-gold">
          THE SOCIAL SEEN
        </p>

        {/* Dashed divider */}
        <div className="mb-5 border-t border-dashed border-gold/30" />

        {/* Heading */}
        <h3 className="mb-5 font-serif text-2xl font-bold text-text-primary">
          {isWaitlisted ? "You\u2019re on the List" : "See You There"}
        </h3>

        {/* Event details */}
        <p className="text-lg font-semibold text-text-primary">{event.title}</p>
        <p className="mt-1 text-sm text-text-primary/60">
          {formatDateModal(event.date_time)}
        </p>
        <p className="text-sm text-text-primary/60">{event.venue_name}</p>

        {/* Booking info */}
        <div className="mt-5 mb-5">
          {isWaitlisted ? (
            <>
              <p className="text-sm text-text-primary/70">
                Waitlist position:{" "}
                <span className="font-semibold text-gold">
                  #{result.waitlistPosition}
                </span>
              </p>
              {userName && (
                <p className="mt-1 font-semibold text-text-primary">
                  {userName}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-text-primary/70">
                1 spot confirmed
                {event.price > 0 && ` — ${formatPrice(event.price)}`}
              </p>
              {userName && (
                <p className="mt-1 font-semibold text-text-primary">
                  {userName}
                </p>
              )}
            </>
          )}
        </div>

        {/* Details box (confirmed bookings only) */}
        {!isWaitlisted && (event.dress_code || true) && (
          <div className="mb-5 rounded-xl bg-bg-primary p-4">
            {event.dress_code && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-primary/60">Dress code</span>
                <span className="font-medium text-text-primary">
                  {event.dress_code}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex items-center justify-between text-sm",
                event.dress_code && "mt-2"
              )}
            >
              <span className="text-text-primary/60">Arrive by</span>
              <span className="font-medium text-text-primary">
                {arriveByTime}
              </span>
            </div>
          </div>
        )}

        {/* Waitlist subtext */}
        {isWaitlisted && (
          <p className="mb-5 text-sm text-text-primary/60">
            We&apos;ll notify you the moment a spot opens up.
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-5">
        {isWaitlisted ? (
          <div className="flex gap-3">
            <a
              href="/events"
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-blush/60 py-3.5 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
            >
              Browse More Events
            </a>
            <button
              onClick={onClose}
              className="flex-1 rounded-2xl bg-gold py-3.5 text-sm font-semibold text-white transition-all hover:bg-gold-dark"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-3">
              <button
                onClick={handleCalendar}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-blush/60 py-3.5 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
              >
                <CalendarPlus className="h-4 w-4" />
                {calendarAdded ? "Added \u2713" : "Add to Calendar"}
              </button>
              <button
                onClick={handleShare}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-blush/60 py-3.5 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
              >
                <Share2 className="h-4 w-4" />
                {linkCopied ? "Link Copied \u2713" : "Share"}
              </button>
            </div>

            <button
              onClick={onClose}
              className="mt-3 w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white transition-all hover:bg-gold-dark"
            >
              Done
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Error alert ──────────────────────────────────────────────────────────────

function ErrorAlert({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-300" />
      <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
    </motion.div>
  );
}
