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

  it("Developer card has no 'Recomendado' pill", () => {
    renderPicker("pt");
    fireEvent.click(ladderRow("developer"));
    expect(screen.queryByText("Recomendado")).toBeNull();
    expect(screen.getAllByText("Melhor custo-benefício").length).toBeGreaterThan(0);
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
        "FREE5 notas / mêsLimitado a 5 notas/mês",
        "DEVELOPERMelhor custo-benefício200 notas / mêsR$ 0,18 por nota excedenteR$ 29,90",
        "GROWTHMais popular850 notas / mêsR$ 0,14 por nota excedenteR$ 99,90",
        "SCALE3.000 notas / mêsR$ 0,12 por nota excedenteR$ 299,90",
        "VOLUME10.000 notas / mêsR$ 0,09 por nota excedenteR$ 699,90",
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
