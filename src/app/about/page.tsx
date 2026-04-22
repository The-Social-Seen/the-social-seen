import type { Metadata } from "next";
import Image from "next/image";
import { Users, Sparkles, Heart } from "lucide-react";
import { CTASection } from "@/components/landing/CTASection";
import { canonicalUrl } from "@/lib/utils/site";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "About | The Social Seen",
  description:
    "The story behind London's most sought-after social community. Learn how a WhatsApp group of friends became 1,000+ professionals gathering over unforgettable evenings.",
  alternates: { canonical: canonicalUrl("/about") },
};

const values = [
  {
    icon: Users,
    title: "Curated, Not Open",
    body: "Every member is here because someone vouched for them. Quality connections over vanity numbers.",
  },
  {
    icon: Sparkles,
    title: "Experiences Over Networking",
    body: "No lanyards. No elevator pitches. Just memorable evenings with interesting people.",
  },
  {
    icon: Heart,
    title: "Community First",
    body: "We host 12+ events a month because our members keep asking for more. That\u2019s the only metric that matters.",
  },
];

const stats = [
  { value: "1,000+", label: "Members" },
  { value: "200+", label: "Events Hosted" },
  { value: "4.8", label: "Average Rating" },
  { value: "12+", label: "Events This Month" },
];

export default function AboutPage() {
  return (
    <main>
      {/* Section 1: Hero */}
      <section className="bg-charcoal px-6 pt-32 pb-16 md:pt-40 md:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
            Our Story
          </p>
          <h1 className="mb-6 font-serif text-4xl font-bold text-white md:text-5xl lg:text-6xl">
            The People Behind the{" "}
            <span className="italic text-gold">Evenings</span>
          </h1>
          <p className="mx-auto max-w-xl font-sans text-lg leading-relaxed text-white/60">
            What started as a WhatsApp group has become London&apos;s most
            sought-after social community.
          </p>
        </div>
      </section>

      {/* Section 2: Origin Story */}
      <section className="bg-bg-primary px-6 py-24 md:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-20">
            <div>
              <p className="mb-4 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
                How It Started
              </p>
              <h2 className="mb-8 font-serif text-3xl font-bold leading-tight text-text-primary md:text-4xl">
                Born From a{" "}
                <span className="italic text-gold">Simple Idea</span>
              </h2>
              <div className="space-y-6 font-sans text-base leading-relaxed text-text-secondary md:text-lg">
                <p>
                  In 2022, a supper club for twelve friends-of-friends sold out
                  in two hours. The WhatsApp group that organised it grew from
                  20 to 200 within weeks. Something had struck a nerve.
                </p>
                <p>
                  London professionals in their 30s and 40s were tired of
                  awkward networking events and surface-level small talk.
                  They wanted wine tastings, gallery openings, rooftop drinks
                  — experiences designed to spark genuine conversation, not
                  collect business cards.
                </p>
                <p>
                  So we kept going. We curated the guest list, chose venues
                  with character, and let the evenings speak for themselves.
                  Now 1,000+ members strong, The Social Seen isn&apos;t a
                  platform — it&apos;s a community built on a simple
                  philosophy: stop networking, start living.
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
                <Image
                  src="https://images.unsplash.com/photo-1543007630-9710e4a00a20?w=800&q=80"
                  alt="Guests enjoying a curated supper club evening"
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
              <div className="absolute -bottom-4 -right-4 -z-10 h-full w-full rounded-2xl border-2 border-gold/30" />
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Values */}
      <section className="bg-bg-secondary px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-16 text-center font-serif text-3xl font-bold text-text-primary md:text-4xl">
            What We{" "}
            <span className="italic text-gold">Believe</span>
          </h2>

          <div className="grid gap-6 sm:grid-cols-3">
            {values.map((value) => (
              <div
                key={value.title}
                className={cn(
                  "rounded-xl border border-border bg-bg-card p-6",
                  "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                )}
              >
                <value.icon className="mb-4 h-8 w-8 text-gold" />
                <h3 className="mb-2 font-sans text-lg font-semibold text-text-primary">
                  {value.title}
                </h3>
                <p className="font-sans text-sm leading-relaxed text-text-secondary">
                  {value.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 4: Stats */}
      <section className="bg-blush/30 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-12">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="font-serif text-3xl font-bold text-gold md:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-2 font-sans text-xs font-medium uppercase tracking-[0.15em] text-text-secondary">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 5: Founder Note */}
      <section className="bg-bg-primary px-6 py-24 md:py-32">
        <div className="mx-auto max-w-2xl border-t border-border pt-16 text-center">
          <p className="mb-6 font-serif text-5xl text-gold/30">&ldquo;</p>
          <p className="mb-8 font-serif text-xl leading-relaxed text-text-primary italic md:text-2xl">
            I started this because I was tired of networking events where
            nobody actually talked. The best evenings I&apos;ve had in London
            weren&apos;t at conferences — they were at dinner tables with
            strangers who became friends by dessert.
          </p>
          <p className="font-sans text-sm font-medium text-text-secondary">
            — Mitesh, Co-Founder
          </p>
        </div>
      </section>

      {/* Section 6: CTA */}
      <CTASection />
    </main>
  );
}
