// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { PLANS, PlanPicker, formatBRL, formatOverage } from "@/components/pricing/plan-picker";
import { paidPlanOffers } from "@/lib/pricing-jsonld";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";
import { readPricingCatalog, type CatalogEntry } from "./helpers/pricing-catalog";

const catalog = readPricingCatalog();
const row = (slug: string) => document.querySelector(`[data-plan="${slug}"]`) as HTMLElement;

/** Same rule as PricingService.recommendPlanForVolume: Free while it fits, else the cheapest paid plan. */
function estimate(volume: number, entries: CatalogEntry[]) {
  const free = entries.find((e) => e.slug === "free")!;
  if (volume <= free.monthlyAllowance) return { plan: free, overage: 0, overageCost: 0, total: 0 };
  const total = (e: CatalogEntry) => e.basePriceCents + Math.max(0, volume - e.monthlyAllowance) * e.perCreditOverageCents;
  const plan = entries.filter((e) => e.slug !== "free").reduce((best, e) => (total(e) < total(best) ? e : best));
  const overage = Math.max(0, volume - plan.monthlyAllowance);
  return { plan, overage, overageCost: overage * plan.perCreditOverageCents, total: total(plan) };
}

describe("price consistency with the billing catalog", () => {
  afterEach(cleanup);

  it("reads all 5 catalog plans", () => {
    expect(catalog.map((e) => e.slug)).toEqual(["free", "developer", "growth", "scale", "volume"]);
  });

  it.each(["pt", "en"] as const)("%s cards show price, quota and overage from the catalog", (locale) => {
    render(
      <NextIntlClientProvider locale={locale} messages={locale === "pt" ? pt : en}>
        <PlanPicker renderAction={() => null} />
      </NextIntlClientProvider>
    );
    const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
    for (const entry of catalog) {
      const plan = PLANS.find((p) => p.slug === entry.slug)!;
      expect([plan.credits, plan.basePriceCents, plan.perCreditCents]).toEqual([entry.monthlyAllowance, entry.basePriceCents, entry.perCreditOverageCents]);
      const text = row(entry.slug).textContent ?? "";
      expect(text).toContain(nf.format(entry.monthlyAllowance));
      if (entry.basePriceCents === 0) {
        expect(text).not.toMatch(/excedente|extra invoice/);
      } else {
        const overage = formatOverage(entry.perCreditOverageCents, locale);
        expect(text).toContain(locale === "pt" ? `${overage} por nota excedente` : `${overage} per extra invoice`);
      }
    }
    expect(formatOverage(12, "pt")).toBe("R$ 0,12");
    expect(formatOverage(12, "en")).toBe("R$ 0.12");
    expect(formatBRL(catalog[1].basePriceCents)).toBe("R$ 29,90");
  });

  it("JSON-LD offers match the catalog, with overage as UnitPriceSpecification", () => {
    const offers = paidPlanOffers("pt");
    const paid = catalog.filter((e) => e.basePriceCents > 0);
    expect(offers).toHaveLength(paid.length);
    offers.forEach((offer, i) => {
      expect(offer.price).toBe((paid[i].basePriceCents / 100).toFixed(2));
      expect(offer.priceSpecification).toEqual([
        {
          "@type": "UnitPriceSpecification",
          price: (paid[i].perCreditOverageCents / 100).toFixed(2),
          priceCurrency: "BRL",
          unitText: "nota excedente",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1 },
        },
      ]);
    });
    expect(offers.map((o) => o.priceSpecification[0].price)).toEqual(["0.12", "0.08", "0.05", "0.05"]);
  });

  it("no message uses 10.000 / 10,000 as the ceiling", () => {
    for (const messages of [pt, en]) expect(JSON.stringify(messages)).not.toMatch(/10[.,]000 (notas|invoices)/);
    expect(pt.Pricing.calculator.custom.description).toContain(new Intl.NumberFormat("pt-BR").format(catalog.at(-1)!.monthlyAllowance));
    expect(en.Pricing.calculator.custom.description).toContain(new Intl.NumberFormat("en-US").format(catalog.at(-1)!.monthlyAllowance));
  });

  it.each(["pt", "en"])("%s docs quote example matches the estimation formula", (locale) => {
    const source = readFileSync(join(__dirname, "..", "lib", "docs", "content", `${locale}.ts`), "utf8");
    const block = source.match(/\{\n {2}"data": \{\n {4}"volume": \d+,[\s\S]*?"billing_cycle": "monthly"\n {2}\}\n\}/)![0];
    const example = JSON.parse(block).data;
    const expected = estimate(example.volume, catalog);
    expect(example).toMatchObject({
      recommended_plan: expected.plan.slug,
      monthly_allowance: expected.plan.monthlyAllowance,
      overage_credits: expected.overage,
      overage_cost_cents: expected.overageCost,
      base_price_cents: expected.plan.basePriceCents,
      total_estimated_cents: expected.total,
    });
    // Reference values for the PR description.
    expect(estimate(20000, catalog)).toMatchObject({ overage: 0, overageCost: 0, total: 69990 });
    expect(estimate(25000, catalog)).toMatchObject({ overage: 5000, overageCost: 25000, total: 94990 });
  });
});
