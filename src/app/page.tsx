import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/utils/site";
import { HeroSection } from "@/components/landing/HeroSection";
import { AboutSection } from "@/components/landing/AboutSection";
import { UpcomingEventsSection } from "@/components/landing/UpcomingEventsSection";
import { SocialProofSection } from "@/components/landing/SocialProofSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { GalleryPreviewSection } from "@/components/landing/GalleryPreviewSection";
import { CTASection } from "@/components/landing/CTASection";
import { getPublishedEvents } from "@/lib/supabase/queries/events";
import { getTopHomepageReviews } from "@/lib/supabase/queries/reviews";
import { isPastEvent } from "@/lib/utils/dates";

export const metadata: Metadata = {
  alternates: { canonical: canonicalUrl("/") },
};

export default async function Home() {
  const [allEvents, topReviews] = await Promise.all([
    getPublishedEvents(),
    getTopHomepageReviews(3),
  ]);
  const upcomingEvents = allEvents
    .filter((e) => !isPastEvent(e.date_time))
    .slice(0, 3);

  return (
    <main>
      <HeroSection />
      <AboutSection />
      <UpcomingEventsSection events={upcomingEvents} />
      <SocialProofSection />
      <TestimonialsSection reviews={topReviews} />
      <GalleryPreviewSection />
      <CTASection />
    </main>
  );
}
