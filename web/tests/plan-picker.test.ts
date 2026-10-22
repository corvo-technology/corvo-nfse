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
    expect(findPlanForVolume(16).slug).toBe("developer");
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
    expect(perNote("developer")).toBe("R$ 0,1196");
    expect(perNote("growth")).toBe("R$ 0,0666");
  });

  it("uses two decimals once a note costs a real or more", () => {
    expect(formatBRLPerNote(2990 / 3)).toBe("R$ 9,97");
  });

  it("keeps the Enterprise overage in line with the backend (R$ 0,05)", () => {
    expect(PLANS.find((p) => p.slug === "volume")!.perCreditCents).toBe(5);
  });
});
