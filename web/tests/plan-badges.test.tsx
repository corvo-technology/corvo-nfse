// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { PLANS, PlanPicker, formatBRL } from "@/components/pricing/plan-picker";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";
import { readPricingCatalog } from "./helpers/pricing-catalog";

const renderPicker = (locale: "pt" | "en") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "pt" ? pt : en}>
      <PlanPicker renderAction={() => null} />
    </NextIntlClientProvider>
  );

const ladderRow = (slug: string) => document.querySelector(`[data-plan="${slug}"]`) as HTMLElement;

describe("pricing badges", () => {
  afterEach(cleanup);

  it.each([
    ["pt", "Mais popular", "Melhor custo-benefício"],
    ["en", "Most popular", "Best value"],
  ] as const)("%s: Growth and Developer show a text badge", (locale, growth, developer) => {
    renderPicker(locale);
    expect(within(ladderRow("growth")).getByText(growth)).toBeTruthy();
    expect(within(ladderRow("developer")).getByText(developer)).toBeTruthy();
    for (const slug of ["free", "scale", "volume"]) expect(within(ladderRow(slug)).queryByTestId(`plan-badge-${slug}`)).toBeNull();
  });

  it("only Growth has the highlight border", () => {
    renderPicker("pt");
    expect(ladderRow("growth").className).toContain("border-accent/30");
    for (const slug of ["free", "developer", "scale", "volume"]) expect(ladderRow(slug).className).not.toContain("border-accent/30");
  });

  it("matches the card snapshot", () => {
    renderPicker("pt");
    expect(PLANS.map((p) => ladderRow(p.slug).textContent)).toMatchInlineSnapshot(`
      [
        "FREE15 notas / mêsLimitado a 15 notas/mês",
        "DEVELOPERMelhor custo-benefício250 notas / mêsR$ 29,90",
        "GROWTHMais popular1.500 notas / mêsR$ 99,90",
        "SCALE6.000 notas / mêsR$ 299,90",
        "VOLUME20.000 notas / mêsR$ 699,90",
      ]
    `);
  });

  it("renders the same prices and quotas as the billing catalog (GET /v1/plans)", () => {
    const catalog = readPricingCatalog();
    expect(catalog.map((entry) => entry.slug)).toEqual(PLANS.map((p) => p.slug));
    renderPicker("pt");
    for (const entry of catalog) {
      const plan = PLANS.find((p) => p.slug === entry.slug)!;
      expect(plan.credits).toBe(entry.monthlyAllowance);
      expect(plan.basePriceCents).toBe(entry.basePriceCents);
      expect(plan.perCreditCents).toBe(entry.perCreditOverageCents);
      const row = ladderRow(entry.slug);
      expect(row.textContent).toContain(`${new Intl.NumberFormat("pt-BR").format(entry.monthlyAllowance)} `);
    }
    for (const entry of catalog.filter((e) => e.basePriceCents > 0)) {
      // Picking a row moves the slider to that plan's full allowance, where the price is the base price.
      fireEvent.click(ladderRow(entry.slug));
      expect(within(ladderRow(entry.slug)).getByText(formatBRL(entry.basePriceCents))).toBeTruthy();
    }
    expect(screen.getAllByText(/R\$/).length).toBeGreaterThan(0);
  });
});
