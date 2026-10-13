"use client";

import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { Architecture } from "@/components/landing/architecture";
import { DashboardShowcase } from "@/components/landing/dashboard-showcase";
import { FreeTrial } from "@/components/landing/free-trial";
import { Pricing } from "@/components/landing/pricing";
import { FlowSection } from "@/components/landing/flow-section";
import { MultiCompanySection } from "@/components/landing/multi-company-section";
import { UseCases } from "@/components/landing/use-cases";
import { Footer } from "@/components/landing/footer";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <Nav />
      <main>
        <Hero />
        <ScrollReveal>
          <Architecture />
        </ScrollReveal>
        <ScrollReveal>
          <DashboardShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <MultiCompanySection />
        </ScrollReveal>
        <ScrollReveal>
          <FlowSection />
        </ScrollReveal>
        <ScrollReveal delay={100}>
          <FreeTrial />
        </ScrollReveal>
        <ScrollReveal delay={100}>
          <Pricing />
        </ScrollReveal>
        <ScrollReveal>
          <UseCases />
        </ScrollReveal>
      </main>
      <Footer />
    </div>
  );
}
