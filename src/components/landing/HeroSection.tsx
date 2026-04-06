"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.3,
    },
  },
};

const fadeUpVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function HeroSection() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=1600&q=80)",
        }}
      />

      {/* Dark overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/70" />

      {/* Content — pt clears the fixed header; pb clears the scroll indicator */}
      <motion.div
        className="relative z-10 mx-auto max-w-4xl px-6 pb-20 pt-20 text-center sm:pt-24"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Tagline */}
        <motion.p
          variants={fadeUpVariants}
          className="mb-6 font-sans text-sm font-medium uppercase tracking-[0.3em] text-gold"
        >
          London&apos;s Premier Social Community
        </motion.p>

        {/* Main Heading */}
        <motion.h1
          variants={fadeUpVariants}
          className="mb-8 font-serif text-5xl font-bold leading-tight text-white md:text-7xl lg:text-8xl"
        >
          Where Connections
          <br />
          Become{" "}
          <span className="italic text-gold">Stories</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={fadeUpVariants}
          className="mx-auto mb-12 max-w-2xl font-sans text-lg leading-relaxed text-white/80 md:text-xl"
        >
          Supper clubs. Gallery openings. Rooftop drinks. London&apos;s most
          interesting professionals, one unforgettable evening at a time.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          variants={fadeUpVariants}
          className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6"
        >
          <Link
            href="/events"
            className={cn(
              "inline-flex items-center justify-center rounded-full px-8 py-4",
              "bg-gold font-sans text-sm font-semibold uppercase tracking-wider text-text-primary",
              "transition-all duration-300 hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/25"
            )}
          >
            See What&apos;s On
          </Link>
          <Link
            href="/join"
            className={cn(
              "inline-flex items-center justify-center rounded-full px-8 py-4",
              "border-2 border-gold font-sans text-sm font-semibold uppercase tracking-wider text-gold",
              "transition-all duration-300 hover:bg-gold/10"
            )}
          >
            Become a Member
          </Link>
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.8 }}
      >
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          className="flex flex-col items-center gap-2"
        >
          <span className="font-sans text-xs uppercase tracking-widest text-white/50">
            Scroll
          </span>
          <ChevronDown className="h-5 w-5 text-white/50" />
        </motion.div>
      </motion.div>
    </section>
  );
}
