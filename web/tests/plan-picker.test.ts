import { describe, expect, it } from "vitest";
import {
  PLANS,
  calcMonthlyTotal,
  findPlanForVolume,
  formatBRLPerNote,
} from "@/components/pricing/plan-picker";

describe("plan picker pricing", () => {
  it("recommends Free up to 15 monthly invoices and a paid plan from 16", () => {
    expect(PLANS.find((plan) => plan.slug === "free")).toEqual({
      slug: "free", credits: 15, basePriceCents: 0, perCreditCents: 0,
    });
    expect(findPlanForVolume(15).slug).toBe("free");
    expect(findPlanForVolume(16).slug).toBe("dev");
  });
  it("picking a plan at its full allowance recommends that same plan", () => {
    for (const plan of PLANS) {
      expect(findPlanForVolume(plan.credits).slug).toBe(plan.slug);
    }
  });

  it("shows the real per-note cost of a full plan with sub-cent precision", () => {
    const perNote = (slug: string) => {
      const plan = PLANS.find((p) => p.slug === slug)!;
      return formatBRLPerNote(calcMonthlyTotal(plan.credits, plan) / plan.credits);
    };
    expect(perNote("dev")).toBe("R$ 0,1196");
    expect(perNote("pro")).toBe("R$ 0,0666");
    expect(perNote("escala")).toBe("R$ 0,0500");
  });

  it("uses two decimals once a note costs a real or more", () => {
    expect(formatBRLPerNote(2990 / 3)).toBe("R$ 9,97");
  });

  it("mirrors the backend v2 catalog (PricingService) exactly", () => {
    expect(PLANS).toEqual([
      { slug: "free", credits: 15, basePriceCents: 0, perCreditCents: 0 },
      { slug: "dev", credits: 250, basePriceCents: 2990, perCreditCents: 12 },
      { slug: "pro", credits: 1500, basePriceCents: 9990, perCreditCents: 8 },
      { slug: "escala", credits: 6000, basePriceCents: 29990, perCreditCents: 5 },
    ]);
  });

  it("offers exactly the four subscribable plans", () => {
    const slugs = PLANS.map((p) => p.slug as string);
    expect(slugs).toEqual(["free", "dev", "pro", "escala"]);
    expect(findPlanForVolume(20000).slug).toBe("escala");
  });
});
