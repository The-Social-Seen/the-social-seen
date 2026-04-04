import { HeroSection } from "@/components/landing/HeroSection";
import { AboutSection } from "@/components/landing/AboutSection";
import { UpcomingEventsSection } from "@/components/landing/UpcomingEventsSection";
import { SocialProofSection } from "@/components/landing/SocialProofSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { GalleryPreviewSection } from "@/components/landing/GalleryPreviewSection";
import { CTASection } from "@/components/landing/CTASection";
import { getPublishedEvents } from "@/lib/supabase/queries/events";
import { isPastEvent } from "@/lib/utils/dates";

export default async function Home() {
  const allEvents = await getPublishedEvents();
  const upcomingEvents = allEvents
    .filter((e) => !isPastEvent(e.date_time))
    .slice(0, 3);

  return (
    <main>
      <HeroSection />
      <AboutSection />
      <UpcomingEventsSection events={upcomingEvents} />
      <SocialProofSection />
      <TestimonialsSection />
      <GalleryPreviewSection />
      <CTASection />
    </main>
  );
}
