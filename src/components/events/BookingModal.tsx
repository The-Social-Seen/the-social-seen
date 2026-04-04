"use client";

import { useState } from "react";
import { SocialEvent } from "@/types";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Minus,
  Plus,
  Calendar,
  MapPin,
  CreditCard,
  Check,
  Share2,
  CalendarPlus,
  Lock,
} from "lucide-react";
import { brandPalette } from "@/config/design-tokens";

interface BookingModalProps {
  event: SocialEvent;
  isOpen: boolean;
  onClose: () => void;
}

export default function BookingModal({
  event,
  isOpen,
  onClose,
}: BookingModalProps) {
  const [step, setStep] = useState(1);
  const [spots, setSpots] = useState(1);
  const [specialRequirements, setSpecialRequirements] = useState("");

  const isFree = event.price === 0;
  const maxSpots = Math.min(4, event.spotsLeft);
  const totalPrice = spots * event.price;

  const totalSteps = isFree ? 3 : 4;

  const handleClose = () => {
    setStep(1);
    setSpots(1);
    setSpecialRequirements("");
    onClose();
  };

  const handleNext = () => {
    if (step === 2 && isFree) {
      // Skip payment step for free events
      setStep(step + 2);
    } else {
      setStep(step + 1);
    }
  };

  const generateIcsLink = () => {
    const start = new Date(event.dateTime)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const end = new Date(event.endTime)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${event.title}`,
      `LOCATION:${event.venueName}, ${event.venueAddress}`,
      `DESCRIPTION:${event.shortDescription}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const blob = new Blob([icsContent], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.slug}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-bg-card shadow-2xl"
          >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-20 rounded-full bg-bg-primary p-2 transition-colors hover:bg-blush/50"
            >
              <X className="h-4 w-4 text-text-primary" />
            </button>

            {/* Progress bar */}
            <div className="flex gap-1.5 px-6 pt-6">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-all duration-300",
                    i < step ? "bg-gold" : "bg-blush/50"
                  )}
                />
              ))}
            </div>

            {/* Steps */}
            <div className="p-6">
              <AnimatePresence mode="wait">
                {/* Step 1: Select spots */}
                {step === 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h3 className="mb-1 text-xl font-bold text-text-primary">
                      How many spots?
                    </h3>
                    <p className="mb-8 text-sm text-text-primary/60">
                      Select the number of spots you&apos;d like to reserve
                    </p>

                    <div className="mb-8 flex items-center justify-center gap-6">
                      <button
                        onClick={() => setSpots(Math.max(1, spots - 1))}
                        disabled={spots <= 1}
                        className={cn(
                          "flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all",
                          spots <= 1
                            ? "border-blush/30 text-blush"
                            : "border-gold text-gold hover:bg-gold hover:text-white"
                        )}
                      >
                        <Minus className="h-5 w-5" />
                      </button>
                      <span className="text-5xl font-bold tabular-nums text-text-primary">
                        {spots}
                      </span>
                      <button
                        onClick={() => setSpots(Math.min(maxSpots, spots + 1))}
                        disabled={spots >= maxSpots}
                        className={cn(
                          "flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all",
                          spots >= maxSpots
                            ? "border-blush/30 text-blush"
                            : "border-gold text-gold hover:bg-gold hover:text-white"
                        )}
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    </div>

                    <p className="mb-6 text-center text-sm text-text-primary/50">
                      {event.spotsLeft} spots remaining &middot; Max 4 per booking
                    </p>

                    <button
                      onClick={handleNext}
                      className="w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white transition-all hover:bg-gold-dark active:scale-[0.98]"
                    >
                      Continue
                    </button>
                  </motion.div>
                )}

                {/* Step 2: Confirm details */}
                {step === 2 && (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h3 className="mb-1 text-xl font-bold text-text-primary">
                      Confirm Details
                    </h3>
                    <p className="mb-6 text-sm text-text-primary/60">
                      Review your booking before confirming
                    </p>

                    <div className="mb-6 space-y-4 rounded-2xl bg-bg-primary p-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-text-primary">
                            {event.title}
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-sm text-text-primary/60">
                            <Calendar className="h-3.5 w-3.5 text-gold" />
                            <span>
                              {format(
                                new Date(event.dateTime),
                                "EEE d MMM, h:mm a"
                              )}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-text-primary/60">
                            <MapPin className="h-3.5 w-3.5 text-gold" />
                            <span>{event.venueName}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-blush/40 pt-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text-primary/60">
                            {spots} {spots === 1 ? "spot" : "spots"} &times;{" "}
                            {isFree
                              ? "Free"
                              : `\u00A3${event.price}`}
                          </span>
                          <span className="font-semibold text-text-primary">
                            {isFree ? "Free" : `\u00A3${totalPrice}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6">
                      <label className="mb-2 block text-sm font-medium text-text-primary">
                        Special requirements{" "}
                        <span className="text-text-primary/40">(optional)</span>
                      </label>
                      <textarea
                        value={specialRequirements}
                        onChange={(e) => setSpecialRequirements(e.target.value)}
                        placeholder="Dietary needs, accessibility, etc."
                        rows={3}
                        className="w-full rounded-xl border border-blush/60 bg-bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-primary/30 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => setStep(1)}
                        className="flex-1 rounded-2xl border border-blush/60 py-4 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
                      >
                        Back
                      </button>
                      <button
                        onClick={handleNext}
                        className="flex-[2] rounded-2xl bg-gold py-4 text-sm font-semibold text-white transition-all hover:bg-gold-dark active:scale-[0.98]"
                      >
                        {isFree ? "Confirm RSVP" : "Continue to Payment"}
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Step 3: Payment (paid events only) */}
                {step === 3 && !isFree && (
                  <motion.div
                    key="step3"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h3 className="mb-1 text-xl font-bold text-text-primary">
                      Payment
                    </h3>
                    <p className="mb-6 text-sm text-text-primary/60">
                      Complete your booking securely
                    </p>

                    {/* Mock Stripe-style UI */}
                    <div className="mb-6 space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-primary">
                          Card number
                        </label>
                        <div className="flex items-center rounded-xl border border-blush/60 bg-bg-primary px-4 py-3">
                          <CreditCard className="mr-3 h-4 w-4 text-text-primary/40" />
                          <span className="text-sm text-text-primary/30">
                            4242 4242 4242 4242
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-text-primary">
                            Expiry
                          </label>
                          <div className="rounded-xl border border-blush/60 bg-bg-primary px-4 py-3">
                            <span className="text-sm text-text-primary/30">
                              MM / YY
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-text-primary">
                            CVC
                          </label>
                          <div className="rounded-xl border border-blush/60 bg-bg-primary px-4 py-3">
                            <span className="text-sm text-text-primary/30">
                              123
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6 rounded-xl bg-bg-primary p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary/60">
                          Total
                        </span>
                        <span className="text-lg font-bold text-text-primary">
                          {"\u00A3"}{totalPrice}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => setStep(2)}
                        className="flex-1 rounded-2xl border border-blush/60 py-4 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
                      >
                        Back
                      </button>
                      <button
                        onClick={() => setStep(4)}
                        className="flex-[2] rounded-2xl bg-charcoal py-4 text-sm font-semibold text-white transition-all hover:bg-charcoal/90 active:scale-[0.98]"
                      >
                        <span className="flex items-center justify-center gap-2">
                          <Lock className="h-3.5 w-3.5" />
                          Pay {"\u00A3"}{totalPrice}
                        </span>
                      </button>
                    </div>

                    <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-text-primary/40">
                      <Lock className="h-3 w-3" />
                      Secured with 256-bit encryption
                    </p>
                  </motion.div>
                )}

                {/* Step 4 (or 3 for free): Confirmation */}
                {((step === 4) || (step === 3 && isFree)) && (
                  <motion.div
                    key="step4"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4, type: "spring" }}
                    className="text-center"
                  >
                    {/* Confetti animation */}
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                      {brandPalette
                        .flatMap((color, ci) =>
                          Array.from({ length: 6 }).map((_, i) => (
                            <motion.div
                              key={`${ci}-${i}`}
                              initial={{
                                opacity: 1,
                                y: -20,
                                x: Math.random() * 400,
                                rotate: 0,
                              }}
                              animate={{
                                opacity: 0,
                                y: 500,
                                rotate: Math.random() * 720 - 360,
                              }}
                              transition={{
                                duration: 2 + Math.random(),
                                delay: Math.random() * 0.5,
                                ease: "easeOut",
                              }}
                              className="absolute h-2 w-2 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                          ))
                        )}
                    </div>

                    {/* Checkmark */}
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{
                        type: "spring",
                        delay: 0.2,
                        stiffness: 200,
                      }}
                      className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100"
                    >
                      <Check className="h-10 w-10 text-emerald-600" strokeWidth={3} />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                    >
                      <h3 className="mb-2 text-2xl font-bold text-text-primary">
                        You&apos;re going!
                      </h3>
                      <p className="mb-2 text-sm text-text-primary/60">
                        {spots} {spots === 1 ? "spot" : "spots"} confirmed for
                      </p>
                      <p className="mb-1 font-semibold text-text-primary">
                        {event.title}
                      </p>
                      <p className="mb-8 text-sm text-gold">
                        {format(new Date(event.dateTime), "EEEE d MMMM, h:mm a")}
                      </p>

                      <div className="flex gap-3">
                        <button
                          onClick={generateIcsLink}
                          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-blush/60 py-3.5 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
                        >
                          <CalendarPlus className="h-4 w-4" />
                          Add to Calendar
                        </button>
                        <button
                          onClick={() => {
                            if (navigator.share) {
                              navigator.share({
                                title: event.title,
                                text: `Join me at ${event.title}!`,
                                url: `/events/${event.slug}`,
                              });
                            }
                          }}
                          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-blush/60 py-3.5 text-sm font-semibold text-text-primary transition-all hover:bg-bg-primary"
                        >
                          <Share2 className="h-4 w-4" />
                          Share
                        </button>
                      </div>

                      <button
                        onClick={handleClose}
                        className="mt-4 w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white transition-all hover:bg-gold-dark"
                      >
                        Done
                      </button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
