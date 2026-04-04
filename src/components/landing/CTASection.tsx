"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

export function CTASection() {
  return (
    <section className="relative overflow-hidden px-6 py-24 md:py-32">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-charcoal via-charcoal to-charcoal/95" />

      {/* Decorative gold circles */}
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-gold/5" />
      <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-gold/5" />

      {/* Subtle pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
        >
          <p className="mb-6 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
            Your Invitation
          </p>

          <h2 className="mb-6 font-serif text-4xl font-bold text-white md:text-5xl lg:text-6xl">
            Ready to Be{" "}
            <span className="italic text-gold">Seen</span>?
          </h2>

          <p className="mx-auto mb-12 max-w-xl font-sans text-lg leading-relaxed text-white/60">
            Join 1,000+ London professionals who&apos;ve swapped small talk
            for supper clubs, gallery openings, and rooftop drinks. Your
            next great evening starts here.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <Link
              href="/join"
              className={cn(
                "inline-flex items-center justify-center rounded-full px-10 py-5",
                "bg-gold font-sans text-base font-semibold uppercase tracking-wider text-charcoal",
                "transition-all duration-300",
                "hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20",
                "active:scale-[0.98]"
              )}
            >
              Become a Member
            </Link>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-6 font-sans text-sm text-white/40"
          >
            Free to join. No commitments. Just great evenings.
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
