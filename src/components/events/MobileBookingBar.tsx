"use client";

import { useState, useEffect, type RefObject } from "react";
import { formatPrice } from "@/lib/utils/currency";
import { motion, AnimatePresence } from "framer-motion";

interface MobileBookingBarProps {
  price: number;
  spotsLeft: number | null;
  isFree: boolean;
  isSoldOut: boolean;
  isPast: boolean;
  onBookClick: () => void;
  sidebarRef: RefObject<HTMLDivElement | null>;
}

export default function MobileBookingBar({
  price,
  spotsLeft,
  isFree,
  isSoldOut,
  isPast,
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

  const ctaText = isSoldOut
    ? "Join Waitlist"
    : isFree
      ? "RSVP Now"
      : "Book Now";

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
            <button
              onClick={onBookClick}
              className="rounded-full bg-gold px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark active:scale-[0.98]"
            >
              {ctaText}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
