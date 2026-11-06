// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentHistory } from "@/components/billing/payment-history";
import type { PaymentRecord } from "@/lib/types";
import pt from "@/messages/pt.json";

const rows: PaymentRecord[] = [
  { id: "p1", kind: "avulso", planSlug: null, cycle: null, units: 20, amountCents: 1980, provider: "woovi", paidAt: "2026-11-05T22:28:48Z" },
  { id: "p2", kind: "plan", planSlug: "equipe", cycle: "annual", units: null, amountCents: 100680, provider: "stripe", paidAt: "2026-11-03T12:00:00Z" },
];
const renderIt = (payments: PaymentRecord[] | null, failed = false) =>
  render(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <PaymentHistory payments={payments} failed={failed} />
    </NextIntlClientProvider>
  );

describe("PaymentHistory (end of the Billing page)", () => {
  afterEach(cleanup);

  it("is a collapsed section titled Pagamentos with the count, rows inside", () => {
    renderIt(rows);
    const section = screen.getByTestId("payment-history") as HTMLDetailsElement;
    expect(section.tagName).toBe("DETAILS");
    expect(section.open).toBe(false);
    expect(section.querySelector("summary")!.textContent).toMatch(/Pagamentos/);
    expect(section.querySelector("summary")!.textContent).toContain("2");
  });

  it("lists what was paid: what, how, when and how much", () => {
    renderIt(rows);
    const list = screen.getAllByTestId("payment-row");
    expect(list).toHaveLength(2);
    expect(list[0].textContent).toContain("20 notas avulsas");
    expect(list[0].textContent).toContain("Pix");
    expect(list[0].textContent).toContain("R$ 19,80");
    expect(list[0].textContent).toContain("05/11/2026");
    expect(list[1].textContent).toContain("Plano Equipe, anual");
    expect(list[1].textContent).toContain("Cartão");
    expect(list[1].textContent).toContain("R$ 1.006,80");
  });

  it("says so when nothing was paid yet", () => {
    renderIt([]);
    expect(screen.getByText("Nenhum pagamento ainda.")).toBeTruthy();
  });

  it("renders nothing while loading, and a quiet note when it failed", () => {
    const { container } = renderIt(null);
    expect(container.textContent).toBe("");
    cleanup();
    renderIt(null, true);
    expect(screen.getByText("Não foi possível carregar os pagamentos.")).toBeTruthy();
  });
});
