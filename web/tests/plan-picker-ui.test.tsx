// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanPicker } from "@/components/pricing/plan-picker";
import { PLANS } from "@/lib/plans-catalog";
import { paidPlanOffers } from "@/lib/pricing-jsonld";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

const renderPicker = (locale: "pt" | "en" = "pt", renderAction: (ctx: { plan: { slug: string }; cycle: string }) => null = () => null) =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "pt" ? pt : en}>
      <PlanPicker renderAction={renderAction as never} />
    </NextIntlClientProvider>
  );
const card = (slug: string) => document.querySelector(`[data-plan="${slug}"]`) as HTMLElement;

describe("plan picker", () => {
  afterEach(cleanup);

  it("shows the four plans in order with the monthly price and quota", () => {
    renderPicker();
    expect(Array.from(document.querySelectorAll("[data-plan]")).map((el) => el.getAttribute("data-plan"))).toEqual(PLANS.map((p) => p.slug));
    expect(card("solo").textContent).toContain("R$ 59,90");
    expect(card("solo").textContent).toContain("100");
    expect(card("escala").textContent).toContain("R$ 399,90");
    expect(card("solo").querySelector("s")).toBeNull();
  });

  it("annual: per-month price, the full monthly price struck through, and the year's total", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("cycle-annual"));
    const solo = card("solo");
    expect(within(solo).getByText("R$ 41,90")).toBeTruthy();
    expect(solo.querySelector("s")!.textContent).toBe("R$ 59,90");
    expect(solo.textContent).toContain("R$ 502,80");
    expect(card("escala").textContent).toContain("R$ 3.358,80");
  });

  it.each([
    ["pt", "Mais popular"],
    ["en", "Most popular"],
  ] as const)("%s: only Equipe carries the badge", (locale, label) => {
    renderPicker(locale);
    expect(within(card("equipe")).getByText(label)).toBeTruthy();
    for (const slug of ["solo", "empresa", "escala"]) expect(within(card(slug)).queryByText(label)).toBeNull();
  });

  it("calculator recommends Equipe for 250 notes and Solo plus avulso for 110", () => {
    renderPicker();
    const input = screen.getByLabelText(/Quantas notas/i);
    fireEvent.change(input, { target: { value: "250" } });
    expect(screen.getByTestId("calculator-result").textContent).toContain("Equipe");
    expect(screen.getByTestId("calculator-result").textContent).toContain("R$ 119,90");
    fireEvent.change(input, { target: { value: "110" } });
    expect(screen.getByTestId("calculator-result").textContent).toContain("Solo");
    expect(screen.getByTestId("calculator-result").textContent).toContain("10");
    expect(screen.getByTestId("calculator-result").textContent).toContain("R$ 69,80");
  });

  it("calculator has a slider that drives the recommendation, with a zone per option", () => {
    renderPicker();
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "700" } });
    const result = screen.getByTestId("calculator-result").textContent ?? "";
    expect(result).toContain("Equipe");
    expect(result).toContain("20");
    const zones = Array.from(document.querySelectorAll("[data-zone]")).map((el) => el.getAttribute("data-zone"));
    expect(zones).toEqual(["avulso", "solo", "equipe", "empresa", "escala"]);
    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByTestId("calculator-result").textContent).toContain("R$ 2,97");
  });

  it("hands the chosen cycle to the card action", () => {
    const action = vi.fn(() => null);
    renderPicker("pt", action);
    fireEvent.click(screen.getByTestId("cycle-annual"));
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ cycle: "annual", plan: expect.objectContaining({ slug: expect.any(String) }) }));
  });

  it("never mentions overage in either language", () => {
    for (const locale of ["pt", "en"] as const) {
      renderPicker(locale);
      expect(document.body.textContent).not.toMatch(/excedente|extra invoice|overage/i);
      cleanup();
    }
  });
});

describe("pricing JSON-LD", () => {
  it.each(["pt", "en"] as const)("%s: one Offer per plan with its monthly price and quota", (locale) => {
    const offers = paidPlanOffers(locale);
    expect(offers).toHaveLength(PLANS.length);
    offers.forEach((offer, i) => {
      expect(offer.price).toBe((PLANS[i].monthlyCents / 100).toFixed(2));
      expect(offer.description).toContain(new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US").format(PLANS[i].credits));
      expect(JSON.stringify(offer)).not.toMatch(/excedente|extra invoice/);
    });
  });
});
