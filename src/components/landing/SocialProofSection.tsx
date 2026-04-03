"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils/cn";

interface CounterProps {
  end: number;
  suffix?: string;
  label: string;
  duration?: number;
}

function AnimatedCounter({ end, suffix = "", label, duration = 2 }: CounterProps) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    if (!isInView) return;

    let startTime: number | null = null;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [isInView, end, duration]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.6 }}
      className="text-center"
    >
      <p className="font-serif text-5xl font-bold text-gold md:text-6xl lg:text-7xl">
        {count.toLocaleString()}
        {suffix}
      </p>
      <p className="mt-3 font-sans text-sm font-medium uppercase tracking-[0.15em] text-charcoal/60">
        {label}
      </p>
    </motion.div>
  );
}

export function SocialProofSection() {
  return (
    <section className={cn("px-6 py-24 md:py-32", "bg-blush/30")}>
      <div className="mx-auto max-w-4xl">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16 text-center font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold"
        >
          The Community in Numbers
        </motion.p>

        <div className="grid grid-cols-1 gap-12 sm:grid-cols-3 sm:gap-8">
          <AnimatedCounter end={1000} suffix="+" label="Members" />
          <AnimatedCounter end={50} suffix="+" label="Events Hosted" />
          <AnimatedCounter end={12} label="Industries Represented" />
        </div>
      </div>
    </section>
  );
}
