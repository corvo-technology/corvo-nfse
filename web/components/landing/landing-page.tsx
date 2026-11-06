"use client";

import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { DashboardShowcase } from "@/components/landing/dashboard-showcase";
import { FreeTrial } from "@/components/landing/free-trial";
import { Pricing } from "@/components/landing/pricing";
import { FlowSection } from "@/components/landing/flow-section";
import { AgentsSection } from "@/components/landing/agents-section";
import { IntegrationsSection } from "@/components/landing/integrations-section";
import { SdksSection } from "@/components/landing/sdks-section";
import { MultiCompanySection } from "@/components/landing/multi-company-section";
import { UseCases } from "@/components/landing/use-cases";
import { FaqSection } from "@/components/landing/faq-section";
import { Footer } from "@/components/landing/footer";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <Nav />
      <main>
        <Hero />
        <ScrollReveal>
          <AgentsSection />
        </ScrollReveal>
        <DashboardShowcase />
        <ScrollReveal>
          <MultiCompanySection />
        </ScrollReveal>
        <ScrollReveal>
          <FlowSection />
        </ScrollReveal>
        <IntegrationsSection />
        <SdksSection />
        <FreeTrial />
        <Pricing />
        <ScrollReveal>
          <UseCases />
        </ScrollReveal>
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}
