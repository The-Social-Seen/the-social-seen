"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface CounterProps {
  end: number;
  suffix?: string;
  label: string;
  duration?: number;
  decimals?: number;
  icon?: ReactNode;
}

function AnimatedCounter({
  end,
  suffix = "",
  label,
  duration = 2,
  decimals = 0,
  icon,
}: CounterProps) {
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
      const raw = eased * end;
      setCount(decimals > 0 ? parseFloat(raw.toFixed(decimals)) : Math.floor(raw));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [isInView, end, duration, decimals]);

  const displayValue = decimals > 0 ? count.toFixed(decimals) : count.toLocaleString();

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.6 }}
      className="text-center"
      aria-label={`${end}${suffix} ${label}`}
    >
      <div className="flex items-center justify-center gap-2">
        <p className="font-serif text-5xl font-bold text-gold md:text-6xl lg:text-7xl">
          {displayValue}
          {suffix}
        </p>
        {icon}
      </div>
      <p className="mt-3 font-sans text-sm font-medium uppercase tracking-[0.15em] text-text-secondary">
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
          Join 1,000+ London Professionals
        </motion.p>

        <div className="grid grid-cols-1 gap-12 sm:grid-cols-3 sm:gap-8">
          <AnimatedCounter end={200} suffix="+" label="Events Hosted" />
          <AnimatedCounter
            end={4.8}
            decimals={1}
            label="Average Rating"
            icon={
              <Star className="h-8 w-8 fill-gold text-gold md:h-10 md:w-10" />
            }
          />
          <AnimatedCounter end={12} suffix="+" label="Events This Month" />
        </div>
      </div>
    </section>
  );
}
