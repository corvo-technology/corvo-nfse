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
import { readPricingCatalog } from "./helpers/pricing-catalog";
import { PricingService } from "../../api/src/modules/plans/application/pricing.service";

const pricing = new PricingService();

const catalog = readPricingCatalog();
const row = (slug: string) => document.querySelector(`[data-plan="${slug}"]`) as HTMLElement;

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

  it.each(["pt", "en"] as const)("%s JSON-LD offers match PricingService: monthly price, quota and overage", (locale) => {
    const offers = paidPlanOffers(locale);
    const paid = (["developer", "growth", "scale", "volume"] as const).map((slug) => pricing.calculateQuote(slug));
    expect(offers).toHaveLength(paid.length);
    offers.forEach((offer, i) => {
      const quote = paid[i];
      expect(offer.price).toBe((quote.monthlyTotalCents / 100).toFixed(2));
      expect(offer.description).toContain(new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US").format(quote.monthlyAllowance));
      expect(offer.priceSpecification).toEqual([
        {
          "@type": "UnitPriceSpecification",
          price: (quote.monthlyTotalCents / 100).toFixed(2),
          priceCurrency: "BRL",
          unitText: "MON",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
        },
        {
          "@type": "UnitPriceSpecification",
          price: (quote.perCreditOverageCents / 100).toFixed(2),
          priceCurrency: "BRL",
          unitText: locale === "pt" ? "nota excedente" : "extra invoice",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1 },
        },
      ]);
    });
  });

  it("the custom-plan ceiling follows the largest plan allowance", () => {
    expect(pt.Pricing.calculator.custom.description).toContain(new Intl.NumberFormat("pt-BR").format(catalog.at(-1)!.monthlyAllowance));
    expect(en.Pricing.calculator.custom.description).toContain(new Intl.NumberFormat("en-US").format(catalog.at(-1)!.monthlyAllowance));
  });

  it.each(["pt", "en"])("%s docs quote example matches PricingService.recommendPlanForVolume", (locale) => {
    const source = readFileSync(join(__dirname, "..", "lib", "docs", "content", `${locale}.ts`), "utf8");
    const block = source.match(/\{\n {2}"data": \{\n {4}"volume": \d+,[\s\S]*?"billing_cycle": "monthly"\n {2}\}\n\}/)![0];
    const example = JSON.parse(block).data;
    const expected = pricing.recommendPlanForVolume(example.volume);
    const quote = pricing.calculateQuote(expected.planSlug);
    expect(example).toMatchObject({
      recommended_plan: expected.planSlug,
      monthly_allowance: quote.monthlyAllowance,
      overage_credits: expected.overageCredits,
      overage_cost_cents: expected.overageCostCents,
      base_price_cents: quote.basePriceCents,
      total_estimated_cents: expected.totalEstimatedCents,
    });
    // Reference values for the PR description, from the real service.
    expect(pricing.recommendPlanForVolume(10000)).toMatchObject({ planSlug: "volume", overageCredits: 0, totalEstimatedCents: 69990 });
    expect(pricing.recommendPlanForVolume(15000)).toMatchObject({ planSlug: "volume", overageCredits: 5000, overageCostCents: 45000, totalEstimatedCents: 114990 });
  });
});
