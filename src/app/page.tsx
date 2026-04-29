import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/utils/site";
import { HeroSection } from "@/components/landing/HeroSection";
import { AboutSection } from "@/components/landing/AboutSection";
import { UpcomingEventsSection } from "@/components/landing/UpcomingEventsSection";
import { SocialProofSection } from "@/components/landing/SocialProofSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
// 2026-04-29: GalleryPreviewSection hidden until upload UI ships. Restore the
// import + render below when ready — see memory/project_event_gallery_hidden.md.
// import { GalleryPreviewSection } from "@/components/landing/GalleryPreviewSection";
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
      {/* GalleryPreviewSection hidden until upload UI ships — see imports above */}
      <CTASection />
    </main>
  );
}
