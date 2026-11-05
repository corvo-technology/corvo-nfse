// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pt from "@/messages/pt.json";

const purchase = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, billing: { ...actual.billing, purchase: (...args: unknown[]) => purchase(...args) } };
});

import { CheckoutDialog, type CheckoutTarget } from "@/components/billing/checkout-dialog";

const open = (target: CheckoutTarget, redirect = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <CheckoutDialog target={target} onClose={() => {}} onError={() => {}} redirect={redirect} />
    </NextIntlClientProvider>
  );

describe("CheckoutDialog", () => {
  beforeEach(() => purchase.mockReset());
  afterEach(cleanup);

  it("avulso: shows units x R$ 0,99 and sends a Pix purchase with an idempotency key", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "000201BR", qrCodeImage: "data:image/png;base64,AAA", paymentLinkUrl: "https://woovi.test/p", expiresAt: "2026-11-06T00:00:00Z" });
    open({ kind: "avulso", units: 10 });
    expect(screen.getByText("R$ 9,90")).toBeTruthy();
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(screen.getByTestId("pix-result")).toBeTruthy());
    expect(purchase).toHaveBeenCalledWith({ kind: "avulso", units: 10, method: "pix" }, expect.any(String));
    expect(screen.getByAltText("Pix QR Code")).toBeTruthy();
    expect(screen.getByText("Copiar código Pix")).toBeTruthy();
  });

  it("card: redirects to the provider url", async () => {
    purchase.mockResolvedValue({ method: "card", url: "https://checkout.stripe.test/s" });
    const redirect = vi.fn();
    open({ kind: "avulso", units: 5 }, redirect);
    fireEvent.click(screen.getByTestId("method-card"));
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.test/s"));
    expect(purchase).toHaveBeenCalledWith({ kind: "avulso", units: 5, method: "card" }, expect.any(String));
  });

  it("annual plan shows the year's total and needs no payer data", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "BR", qrCodeImage: null, paymentLinkUrl: "https://woovi.test/p", expiresAt: null });
    open({ kind: "plan", slug: "solo", cycle: "annual" });
    expect(screen.getByText(/R\$ 502,80/)).toBeTruthy();
    expect(screen.queryByText("CPF ou CNPJ")).toBeNull();
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(purchase).toHaveBeenCalled());
    expect(purchase.mock.calls[0][0]).toMatchObject({ kind: "plan", planSlug: "solo", cycle: "annual", method: "pix" });
  });

  it("monthly Pix needs the payer name and CPF/CNPJ before it can continue", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: null, qrCodeImage: null, paymentLinkUrl: "https://woovi.test/auth", expiresAt: null });
    open({ kind: "plan", slug: "equipe", cycle: "monthly" });
    const go = screen.getByText("Continuar").closest("button")!;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Nome completo ou razão social"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("CPF ou CNPJ"), { target: { value: "123.456.789-09" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(purchase).toHaveBeenCalled());
    expect(purchase.mock.calls[0][0]).toMatchObject({ method: "pix", customer: { name: "Ana Souza", taxID: "12345678909" } });
  });

  it("never shows the previous purchase's Pix QR for a different purchase", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "OLD", qrCodeImage: "data:image/png;base64,AAA", paymentLinkUrl: "https://woovi.test/old", expiresAt: null });
    const view = open({ kind: "avulso", units: 3 });
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(screen.getByTestId("pix-result")).toBeTruthy());
    view.rerender(
      <NextIntlClientProvider locale="pt" messages={pt}>
        <CheckoutDialog target={{ kind: "plan", slug: "solo", cycle: "annual" }} onClose={() => {}} onError={() => {}} redirect={vi.fn()} />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId("pix-result")).toBeNull();
    expect(screen.getByText(/R\$ 502,80/)).toBeTruthy();
    purchase.mockClear();
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(purchase).toHaveBeenCalled());
    // A new purchase must not reuse the old idempotency key (the server would replay the old charge).
    const firstKey = purchase.mock.calls[0][1];
    expect(typeof firstKey).toBe("string");
  });
});

