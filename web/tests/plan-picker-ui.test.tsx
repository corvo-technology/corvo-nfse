// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanPicker } from "@/components/pricing/plan-picker";
import { PLANS } from "@/lib/plans-catalog";
import { paidPlanOffers } from "@/lib/pricing-jsonld";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

const renderPicker = (locale: "pt" | "en" = "pt", renderAction: (ctx: unknown) => null = () => null) =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "pt" ? pt : en}>
      <PlanPicker renderAction={renderAction as never} />
    </NextIntlClientProvider>
  );
const row = (slug: string) => document.querySelector(`[data-plan="${slug}"]`) as HTMLElement;
const featured = () => screen.getByTestId("featured-plan");
const type = (value: string) => fireEvent.change(screen.getByLabelText(/Quantas notas/i), { target: { value } });

describe("plan picker", () => {
  afterEach(cleanup);

  it("lists avulso and the four plans on the right, with the monthly price", () => {
    renderPicker();
    expect(Array.from(document.querySelectorAll("[data-plan]")).map((el) => el.getAttribute("data-plan"))).toEqual(["avulso", ...PLANS.map((p) => p.slug)]);
    expect(row("solo").textContent).toContain("R$ 59,90");
    expect(row("escala").textContent).toContain("R$ 399,90");
    expect(row("solo").querySelector("s")).toBeNull();
    expect(row("avulso").textContent).toContain("R$ 0,99");
  });

  it("starts on 250 notes: Equipe is the featured plan", () => {
    renderPicker();
    expect(featured().textContent).toContain("EQUIPE");
    expect(featured().textContent).toContain("R$ 119,90");
    expect(row("equipe").getAttribute("aria-current")).toBe("true");
  });

  it("annual: struck monthly price, per-month price and the year's total", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("cycle-annual"));
    expect(featured().querySelector("s")!.textContent).toBe("R$ 119,90");
    expect(featured().textContent).toContain("R$ 83,90");
    expect(featured().textContent).toContain("R$ 1.006,80");
    expect(row("solo").querySelector("s")!.textContent).toBe("R$ 59,90");
    expect(within(row("solo")).getByText("R$ 41,90")).toBeTruthy();
  });

  it.each([
    ["pt", "Mais popular"],
    ["en", "Most popular"],
  ] as const)("%s: only Equipe carries the badge", (locale, label) => {
    renderPicker(locale);
    expect(within(row("equipe")).getByText(label)).toBeTruthy();
    for (const slug of ["solo", "empresa", "escala", "avulso"]) expect(within(row(slug)).queryByText(label)).toBeNull();
  });

  it("typing 110 notes recommends Solo plus 10 single notes", () => {
    renderPicker();
    type("110");
    expect(featured().textContent).toContain("SOLO");
    expect(featured().textContent).toContain("10");
    expect(featured().textContent).toContain("R$ 69,80");
  });

  it("the slider starts at 3 notes: avulso only, R$ 2,97", () => {
    renderPicker();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(featured().textContent).toContain("R$ 2,97");
    expect(featured().textContent).toMatch(/avulsas|AVULSAS/);
    expect(row("avulso").getAttribute("aria-current")).toBe("true");
  });

  it("the slider drives the recommendation and draws a zone per option", () => {
    renderPicker();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "651" } });
    expect(featured().textContent).toContain("EQUIPE");
    expect(featured().textContent).toContain("20");
    const zones = Array.from(document.querySelectorAll("[data-zone]")).map((el) => el.getAttribute("data-zone"));
    expect(zones).toEqual(["avulso", "solo", "equipe", "empresa", "escala"]);
  });

  it("clicking a plan row moves the slider to that plan's full quota", () => {
    renderPicker();
    fireEvent.click(row("empresa"));
    expect(featured().textContent).toContain("EMPRESA");
    expect((screen.getByLabelText(/Quantas notas/i) as HTMLInputElement).value).toBe("600");
  });

  it("hands the plan, cycle and extra notes to the action", () => {
    const action = vi.fn(() => null);
    renderPicker("pt", action);
    type("110");
    fireEvent.click(screen.getByTestId("cycle-annual"));
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ cycle: "annual", avulsoUnits: 10, plan: expect.objectContaining({ slug: "solo" }) }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ plan: null, avulsoUnits: 3 }));
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
