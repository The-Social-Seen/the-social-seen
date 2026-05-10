"use client";

import { useState, useEffect, type RefObject } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils/currency";
import { motion, AnimatePresence } from "framer-motion";

interface MobileBookingBarProps {
  price: number;
  spotsLeft: number | null;
  isFree: boolean;
  isSoldOut: boolean;
  isPast: boolean;
  /**
   * When false, the CTA renders as a Link to /login (preserving the
   * current event slug + `?book=1` so the BookingModal auto-opens
   * after auth). Mirrors `BookingSidebar.LoggedOutState`'s behaviour
   * for parity between mobile and desktop. The desktop sidebar is
   * already gated; this prop closes the mobile gap that previously
   * let a logged-out user reach BookingModal → Server Action →
   * "Authentication required" error banner.
   */
  isLoggedIn: boolean;
  /**
   * Event slug used to construct the post-login redirect target.
   * Required when !isLoggedIn so the user lands back on this event
   * with `?book=1` after signing in (or registering).
   */
  eventSlug: string;
  onBookClick: () => void;
  sidebarRef: RefObject<HTMLDivElement | null>;
}

export default function MobileBookingBar({
  price,
  spotsLeft,
  isFree,
  isSoldOut,
  isPast,
  isLoggedIn,
  eventSlug,
  onBookClick,
  sidebarRef,
}: MobileBookingBarProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show bar when sidebar is NOT visible
        setVisible(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [sidebarRef]);

  // Don't render for past events
  if (isPast) return null;

  // CTA copy: a logged-out user always sees the auth-gated copy (matches
  // BookingSidebar.LoggedOutState, src/components/events/BookingSidebar.tsx:252).
  // Logged-in users get the same context-aware copy as before.
  const ctaText = !isLoggedIn
    ? "Sign In to Book"
    : isSoldOut
      ? "Join Waitlist"
      : isFree
        ? "RSVP Now"
        : "Book Now";

  // Shared CTA styling so the <Link> (logged-out) and <button> (logged-in)
  // look identical. Keeping a single string here avoids drift if the
  // primary-CTA pattern changes.
  const ctaClassName =
    "rounded-full bg-gold px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark active:scale-[0.98]";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border-light bg-bg-card/95 backdrop-blur-lg lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-lg font-bold text-text-primary">
                {formatPrice(price)}
                {!isFree && (
                  <span className="ml-1 text-sm font-normal text-text-tertiary">
                    per person
                  </span>
                )}
              </p>
              {spotsLeft !== null && spotsLeft > 0 && spotsLeft < 10 && (
                <p className="text-xs font-semibold text-gold">
                  {spotsLeft} spots left
                </p>
              )}
            </div>
            {isLoggedIn ? (
              <button onClick={onBookClick} className={ctaClassName}>
                {ctaText}
              </button>
            ) : (
              <Link
                href={`/login?redirect=/events/${eventSlug}?book=1`}
                className={ctaClassName}
              >
                {ctaText}
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
