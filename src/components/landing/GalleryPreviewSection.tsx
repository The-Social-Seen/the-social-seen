"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { allGalleryPhotos } from "@/data/events";
import { cn } from "@/lib/utils/cn";

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const imageVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function GalleryPreviewSection() {
  const photos = allGalleryPhotos.slice(0, 6);

  return (
    <section className="bg-bg-primary px-6 py-24 md:py-32">
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
            Gallery
          </p>
          <h2 className="mb-4 font-serif text-4xl font-bold text-text-primary md:text-5xl">
            Moments That Matter
          </h2>
          <p className="mx-auto max-w-xl font-sans text-lg text-text-secondary">
            A glimpse into the evenings, mornings, and everything in between
            that make our community special.
          </p>
        </motion.div>

        {/* Asymmetric gallery grid */}
        <motion.div
          className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
        >
          {photos.map((photo, index) => (
            <motion.div
              key={photo.id}
              variants={imageVariants}
              className={cn(
                "group relative overflow-hidden rounded-xl",
                // Asymmetric: first and fourth images span 2 rows
                index === 0 && "row-span-2 aspect-[3/4] md:aspect-auto",
                index === 3 && "row-span-2 aspect-[3/4] md:aspect-auto",
                index !== 0 && index !== 3 && "aspect-square"
              )}
            >
              <Image
                src={photo.imageUrl}
                alt={photo.caption || "Gallery photo"}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-110"
                sizes="(max-width: 768px) 50vw, 33vw"
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-charcoal/0 transition-colors duration-300 group-hover:bg-charcoal/30" />
              {photo.caption && (
                <div className="absolute inset-x-0 bottom-0 translate-y-full p-4 transition-transform duration-300 group-hover:translate-y-0">
                  <p className="font-sans text-sm font-medium text-white">
                    {photo.caption}
                  </p>
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>

        {/* View full gallery link */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="mt-14 text-center"
        >
          <Link
            href="/gallery"
            className="group inline-flex items-center gap-2 font-sans text-sm font-semibold uppercase tracking-wider text-gold transition-colors hover:text-gold/80"
          >
            View Full Gallery
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
