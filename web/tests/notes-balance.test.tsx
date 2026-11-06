// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { NotesBalance } from "@/components/dashboard/notes-balance";
import type { BillingPlan } from "@/lib/types";
import pt from "@/messages/pt.json";

const usage = (patch: Partial<BillingPlan["usage"]> = {}, blocked = false) =>
  ({
    slug: "free",
    name: "Sem plano",
    monthlyPriceCents: 0,
    subscription: { status: "none", paidUntil: null, cancelAtPeriodEnd: false, scheduledPlan: null, blocked, pixSubscription: false },
    usage: { creditsUsed: 0, creditsReserved: 0, creditsRemaining: 0, monthlyAllowance: 0, dailyUsage: 0, dailyLimit: null, activeCompanies: 0, maxActiveCompanies: 999999, periodStart: "", periodEnd: "", avulsoBalance: 0, ...patch },
  }) as BillingPlan;

const renderIt = (plan: BillingPlan) =>
  render(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <NotesBalance plan={plan} />
    </NextIntlClientProvider>
  );

describe("NotesBalance", () => {
  afterEach(cleanup);

  it("no plan: shows the avulso balance as what can be issued, never 0/0", () => {
    renderIt(usage({ avulsoBalance: 21 }));
    expect(screen.getByTestId("notes-available").textContent).toBe("21");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent).not.toContain("0/0");
    expect(screen.getByText(/Avulsas/)).toBeTruthy();
  });

  it("with a plan: available = what is left of the plan plus avulso, with the plan bar", () => {
    renderIt(usage({ monthlyAllowance: 100, creditsUsed: 40, creditsRemaining: 60, avulsoBalance: 5 }));
    expect(screen.getByTestId("notes-available").textContent).toBe("65");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText(/60 de 100/)).toBeTruthy();
  });

  it("a lapsed plan (blocked) does not count its leftover notes", () => {
    renderIt(usage({ monthlyAllowance: 100, creditsUsed: 40, creditsRemaining: 60, avulsoBalance: 5 }, true));
    expect(screen.getByTestId("notes-available").textContent).toBe("5");
  });

  it("nothing left: says so and points to buying notes", () => {
    renderIt(usage());
    expect(screen.getByTestId("notes-available").textContent).toBe("0");
    expect(screen.getByRole("link", { name: /Comprar notas/ }).getAttribute("href")).toBe("/app/billing");
  });
});
