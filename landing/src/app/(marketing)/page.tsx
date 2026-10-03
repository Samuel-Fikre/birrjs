import { CliSection } from "@/components/sections/cli-section";
import { CTASection } from "@/components/sections/cta-section";
import { FeaturesSection } from "@/components/sections/features-section";
import { FooterSection } from "@/components/sections/footer-section";
import { HeroSection } from "@/components/sections/hero-section";
import { ProvidersSection } from "@/components/sections/providers-section";

export default function HomePage() {
  return (
    <div className="relative">
      <HeroSection />
      <ProvidersSection />
      <CliSection />
      <FeaturesSection />
      <CTASection />
      <FooterSection />
    </div>
  );
}
