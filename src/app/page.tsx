import { HeroSection } from "@/components/landing/HeroSection";
import { AboutSection } from "@/components/landing/AboutSection";
import { UpcomingEventsSection } from "@/components/landing/UpcomingEventsSection";
import { SocialProofSection } from "@/components/landing/SocialProofSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { GalleryPreviewSection } from "@/components/landing/GalleryPreviewSection";
import { CTASection } from "@/components/landing/CTASection";

export default function Home() {
  return (
    <main>
      <HeroSection />
      <AboutSection />
      <UpcomingEventsSection />
      <SocialProofSection />
      <TestimonialsSection />
      <GalleryPreviewSection />
      <CTASection />
    </main>
  );
}
