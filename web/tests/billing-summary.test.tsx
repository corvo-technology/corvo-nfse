// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingSummary } from "@/components/billing/billing-summary";
import type { BillingPlan } from "@/lib/types";
import pt from "@/messages/pt.json";

type Patch = { name?: string; slug?: string; price?: number; sub?: Partial<BillingPlan["subscription"]>; usage?: Partial<BillingPlan["usage"]> };
const plan = (p: Patch = {}) =>
  ({
    slug: p.slug ?? "free",
    name: p.name ?? "Sem plano",
    monthlyPriceCents: p.price ?? 0,
    subscription: { status: "none", paidUntil: null, cancelAtPeriodEnd: false, scheduledPlan: null, blocked: false, pixSubscription: false, ...p.sub },
    usage: { creditsUsed: 0, creditsReserved: 0, creditsRemaining: 0, monthlyAllowance: 0, dailyUsage: 0, dailyLimit: null, activeCompanies: 1, maxActiveCompanies: 999999, periodStart: "2026-11-01T00:00:00Z", periodEnd: "2026-12-01T00:00:00Z", avulsoBalance: 0, ...p.usage },
  }) as BillingPlan;

const handlers = () => ({ onPortal: vi.fn(), onCancelPix: vi.fn(), onBuyNotes: vi.fn() });
const renderIt = (billing: BillingPlan, extra: Partial<{ canManage: boolean; billingEnabled: boolean; busy: string | null }> = {}) => {
  const h = handlers();
  render(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <BillingSummary billing={billing} canManage={extra.canManage ?? true} billingEnabled={extra.billingEnabled ?? true} busy={extra.busy ?? null} {...h} />
    </NextIntlClientProvider>
  );
  return h;
};
const available = () => screen.getByTestId("summary-available").textContent;

describe("BillingSummary", () => {
  afterEach(cleanup);

  it("no plan: the headline is what can be issued, with no plan price and no 0/0 bar", () => {
    renderIt(plan({ usage: { avulsoBalance: 21 } }));
    expect(available()).toBe("21");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent).not.toContain("0 / 0");
    expect(document.body.textContent).not.toMatch(/R\$\s?0,00/);
    expect(screen.getByText(/Avulsas: 21/)).toBeTruthy();
  });

  it("with a plan: available = plan left + avulso, the usage bar, the price and the paid-until date", () => {
    renderIt(plan({ slug: "equipe", name: "Equipe", price: 11990, sub: { status: "active", paidUntil: "2026-12-01T00:00:00Z" }, usage: { monthlyAllowance: 250, creditsUsed: 50, creditsRemaining: 200, avulsoBalance: 5 } }));
    expect(available()).toBe("205");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText(/Plano: 200 de 250/)).toBeTruthy();
    expect(screen.getByText(/119,90/)).toBeTruthy();
    expect(screen.getByText(/Pago até 01\/12\/2026/)).toBeTruthy();
  });

  it("period and active companies are one small line, not two cards", () => {
    renderIt(plan({ usage: { avulsoBalance: 1, activeCompanies: 3, maxActiveCompanies: 999999 } }));
    const meta = screen.getByTestId("summary-meta").textContent ?? "";
    expect(meta).toContain("01/11/2026");
    expect(meta).toContain("01/12/2026");
    expect(meta).toMatch(/3/);
  });

  it("shows exactly one notice, the most important one first", () => {
    renderIt(plan({ sub: { blocked: true, cancelAtPeriodEnd: true, scheduledPlan: "solo" }, usage: {} }));
    const notices = screen.getAllByTestId("summary-notice");
    expect(notices).toHaveLength(1);
    expect(notices[0].getAttribute("data-kind")).toBe("blocked");
  });

  it.each([
    ["out-of-quota", plan({ usage: {} })],
    ["cancels-at-end", plan({ slug: "solo", name: "Solo", usage: { creditsRemaining: 10, monthlyAllowance: 100 }, sub: { cancelAtPeriodEnd: true, status: "active" } })],
    ["scheduled", plan({ slug: "equipe", name: "Equipe", usage: { creditsRemaining: 10, monthlyAllowance: 250 }, sub: { scheduledPlan: "solo", status: "active", paidUntil: "2026-12-01T00:00:00Z" } })],
  ])("notice order: %s", (kind, billing) => {
    renderIt(billing);
    expect(screen.getByTestId("summary-notice").getAttribute("data-kind")).toBe(kind);
  });

  it("no notice when everything is fine", () => {
    renderIt(plan({ usage: { avulsoBalance: 4 } }));
    expect(screen.queryByTestId("summary-notice")).toBeNull();
  });

  it("account actions live in the card: manage billing and cancel Pix Automático", () => {
    const h = renderIt(plan({ slug: "solo", name: "Solo", price: 5990, sub: { status: "active", pixSubscription: true }, usage: { monthlyAllowance: 100, creditsRemaining: 90 } }));
    fireEvent.click(screen.getByRole("button", { name: "Gerenciar cobrança" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar Pix Automático" }));
    expect(h.onPortal).toHaveBeenCalledTimes(1);
    expect(h.onCancelPix).toHaveBeenCalledTimes(1);
  });

  it("without permission or outside live mode the account actions are hidden or disabled", () => {
    renderIt(plan({ slug: "solo", name: "Solo", sub: { status: "active", pixSubscription: true } }), { canManage: false });
    expect(screen.queryByRole("button", { name: "Cancelar Pix Automático" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gerenciar cobrança" })).toBeNull();
  });

  it("'Comprar notas' takes the user to the plan picker", () => {
    const h = renderIt(plan());
    fireEvent.click(within(screen.getByTestId("billing-summary")).getByRole("button", { name: "Comprar notas" }));
    expect(h.onBuyNotes).toHaveBeenCalledTimes(1);
  });
});
