"use client";

import Image from "next/image";
import { motion } from "framer-motion";

const fadeInLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

const fadeInRight = {
  hidden: { opacity: 0, x: 40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function AboutSection() {
  return (
    <section className="bg-bg-primary px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
          {/* Text column */}
          <motion.div
            variants={fadeInLeft}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
          >
            <p className="mb-4 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
              Our Story
            </p>

            <h2 className="mb-8 font-serif text-4xl font-bold leading-tight text-text-primary md:text-5xl">
              More Than
              <br />
              <span className="italic text-gold">Networking</span>
            </h2>

            <div className="space-y-6 font-sans text-base leading-relaxed text-text-secondary md:text-lg">
              <p>
                The Social Seen was born from a simple belief: the best
                connections happen when you stop trying to network and start
                living. What began as a WhatsApp group of friends-of-friends has
                grown into something extraordinary.
              </p>
              <p>
                We are a community of London professionals in their 30s and 40s
                who are tired of awkward networking events and surface-level
                small talk. Instead, we gather over wine tastings, supper clubs,
                gallery openings, and sunrise yoga sessions — experiences
                designed to spark genuine conversation and lasting friendships.
              </p>
              <p>
                Now <span className="font-semibold text-text-primary">1,000+ members strong</span>,
                we have become London&apos;s most sought-after social community. Not
                because we tried to be, but because when you bring the right
                people together in the right setting, magic happens.
              </p>
            </div>
          </motion.div>

          {/* Image column */}
          <motion.div
            variants={fadeInRight}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="relative"
          >
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
              <Image
                src="https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=800&q=80"
                alt="Friends enjoying a social event together"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </div>

            {/* Gold accent border */}
            <div className="absolute -bottom-4 -right-4 -z-10 h-full w-full rounded-2xl border-2 border-gold/30" />

            {/* Floating stat card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="absolute -bottom-6 -left-6 rounded-xl bg-charcoal px-6 py-4 shadow-xl"
            >
              <p className="font-serif text-3xl font-bold text-gold">1,000+</p>
              <p className="font-sans text-sm text-white/70">Active Members</p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
