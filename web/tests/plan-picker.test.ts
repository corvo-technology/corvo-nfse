import { describe, expect, it } from "vitest";
import { AVULSO_UNIT_CENTS, PLANS, chargeTotalCents, perMonthCents, recommendForNotes } from "@/lib/plans-catalog";
import { readPricingCatalog } from "./helpers/pricing-catalog";

describe("plan catalog", () => {
  it("matches the billing catalog in the API (slugs, quota, monthly and annual price)", () => {
    const catalog = readPricingCatalog();
    expect(catalog.map((e) => e.slug)).toEqual(PLANS.map((p) => p.slug));
    for (const entry of catalog) {
      const plan = PLANS.find((p) => p.slug === entry.slug)!;
      expect([plan.credits, plan.monthlyCents, plan.annualMonthlyCents]).toEqual([entry.monthlyAllowance, entry.basePriceCents, entry.annualMonthlyCents]);
    }
  });

  it("the annual price is 30% off the monthly one, charged 12 months at once", () => {
    for (const plan of PLANS) {
      expect(Math.abs(plan.annualMonthlyCents / plan.monthlyCents - 0.7)).toBeLessThan(0.005);
    }
    const solo = PLANS[0];
    expect(perMonthCents(solo, "annual")).toBe(4190);
    expect(chargeTotalCents(solo, "annual")).toBe(50280);
    expect(chargeTotalCents(solo, "monthly")).toBe(5990);
  });

  it("calculator: 250 notes -> Equipe; 110 -> Solo + 10 avulso; 3 -> avulso only", () => {
    expect(recommendForNotes(250, "monthly")!.option).toEqual({ planSlug: "equipe", avulsoUnits: 0, totalCents: 11990 });
    expect(recommendForNotes(110, "monthly")!.option).toEqual({ planSlug: "solo", avulsoUnits: 10, totalCents: 5990 + 10 * AVULSO_UNIT_CENTS });
    expect(recommendForNotes(3, "monthly")!.option).toEqual({ planSlug: null, avulsoUnits: 3, totalCents: 297 });
    expect(recommendForNotes(250, "annual")!.option.totalCents).toBe(8390);
  });

  it.each([0, -1, 2.5, Number.NaN, 1_000_001])("calculator rejects %s notes", (notes) => {
    expect(recommendForNotes(notes, "monthly")).toBeNull();
  });

  it("calculator never suggests fewer than 3 avulso notes (the purchase minimum)", () => {
    expect(recommendForNotes(101, "monthly")!.option).toEqual({ planSlug: "solo", avulsoUnits: 3, totalCents: 5990 + 3 * AVULSO_UNIT_CENTS });
    expect(recommendForNotes(2, "monthly")!.option).toEqual({ planSlug: null, avulsoUnits: 3, totalCents: 297 });
    for (const n of [1, 2, 101, 102, 351]) {
      const r = recommendForNotes(n, "monthly")!;
      for (const o of [r.option, ...r.alternatives]) expect(o.avulsoUnits === 0 || o.avulsoUnits >= 3).toBe(true);
    }
  });
});

