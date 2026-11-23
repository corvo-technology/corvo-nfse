// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pt from "@/messages/pt.json";

const purchase = vi.fn();
const plan = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, billing: { ...actual.billing, purchase: (...args: unknown[]) => purchase(...args), plan: (...args: unknown[]) => plan(...args) } };
});

import { CheckoutDialog, type CheckoutTarget } from "@/components/billing/checkout-dialog";
import { ApiError } from "@/lib/api";

const open = (target: CheckoutTarget, redirect = vi.fn(), extra: { onPaid?: () => void; pollMs?: number; onError?: (c: unknown) => void; resume?: { brCode: string | null; paymentLinkUrl: string } } = {}) =>
  render(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <CheckoutDialog target={target} onClose={() => {}} onError={() => {}} redirect={redirect} {...extra} />
    </NextIntlClientProvider>
  );

describe("CheckoutDialog", () => {
  beforeEach(() => { purchase.mockReset(); plan.mockReset(); plan.mockResolvedValue({ slug: "free", usage: { avulsoBalance: 0 } }); });
  afterEach(cleanup);

  it("avulso: shows units x R$ 0,99 and sends a Pix purchase with an idempotency key", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "000201BR", qrCodeImage: "data:image/png;base64,AAA", paymentLinkUrl: "https://woovi.test/p", expiresAt: "2026-11-06T00:00:00Z" });
    open({ kind: "avulso", units: 10 });
    expect(screen.getByText("R$ 9,90")).toBeTruthy();
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(screen.getByTestId("pix-result")).toBeTruthy());
    expect(purchase).toHaveBeenCalledWith({ kind: "avulso", units: 10, method: "pix" }, expect.any(String));
    expect((await screen.findByAltText("Pix QR Code")).getAttribute("src")).toMatch(/^data:image\//);
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

  it("monthly Pix collects just the payer basics (name, document, e-mail, phone) before it can continue", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "000201EMV", qrCodeImage: null, paymentLinkUrl: "https://woovi.test/auth", expiresAt: null });
    open({ kind: "plan", slug: "equipe", cycle: "monthly" });
    const go = screen.getByText("Continuar").closest("button")!;
    expect(go.disabled).toBe(true);
    const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fill("Nome completo ou razão social", "Ana Souza");
    fill("CPF ou CNPJ", "123.456.789-09");
    expect(go.disabled).toBe(true);
    expect(go.disabled).toBe(true);
    fill("E-mail", "ana@x.com");
    fill("Telefone com DDD", "(11) 99999-9999");
    expect(screen.queryByLabelText("CEP")).toBeNull();
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(purchase).toHaveBeenCalled());
    expect(purchase.mock.calls[0][0]).toMatchObject({
      method: "pix",
      customer: {
        name: "Ana Souza",
        taxID: "12345678909",
        email: "ana@x.com",
        phone: "5511999999999",
      },
    });
  });

  it("formats the document and the phone while the payer types", () => {
    open({ kind: "plan", slug: "equipe", cycle: "monthly" });
    const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(input("CPF ou CNPJ"), { target: { value: "12345678909" } });
    expect(input("CPF ou CNPJ").value).toBe("123.456.789-09");
    fireEvent.change(input("CPF ou CNPJ"), { target: { value: "12345678000195" } });
    expect(input("CPF ou CNPJ").value).toBe("12.345.678/0001-95");
    fireEvent.change(input("Telefone com DDD"), { target: { value: "11999999999" } });
    expect(input("Telefone com DDD").value).toBe("(11) 99999-9999");
    expect(input("Telefone com DDD").getAttribute("inputmode")).toBe("tel");
    expect(input("E-mail").getAttribute("type")).toBe("email");
    expect(input("E-mail").getAttribute("autocomplete")).toBe("email");
  });

  it("card and annual Pix never ask for the payer", () => {
    open({ kind: "plan", slug: "equipe", cycle: "monthly" });
    fireEvent.click(screen.getByTestId("method-card"));
    expect(screen.queryByLabelText("CEP")).toBeNull();
    expect(screen.queryByLabelText("E-mail")).toBeNull();
  });

  it("asks Pix or card as two clear choices, Pix selected first", () => {
    open({ kind: "avulso", units: 5 });
    expect(screen.getByTestId("method-pix").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("method-card").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Aprova na hora. O código vale por 24 horas.")).toBeTruthy();
    expect(screen.getByText("Pagamento seguro no cartão.")).toBeTruthy();
  });

  it("builds the QR code from the brCode even when Woovi only sends a hosted image url, and shows the countdown", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "00020126580014BR.GOV.BCB.PIX0136abc", qrCodeImage: "https://api.woovi.test/qr/1.png", paymentLinkUrl: "https://woovi.test/p", expiresAt: new Date(Date.now() + 90 * 60_000 - 30_000).toISOString() });
    open({ kind: "avulso", units: 3 });
    fireEvent.click(screen.getByText("Continuar"));
    expect((await screen.findByAltText("Pix QR Code")).getAttribute("src")).toMatch(/^data:image\//);
    expect(screen.getByText(/Expira em 01:29:/)).toBeTruthy();
    expect(screen.getByText("Aguardando o pagamento…")).toBeTruthy();
  });

  it("detects the payment by itself: avulso balance grows, the dialog says confirmed and refreshes", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "BR", qrCodeImage: null, paymentLinkUrl: "https://woovi.test/p", expiresAt: null });
    plan.mockResolvedValueOnce({ slug: "free", usage: { avulsoBalance: 2 } }).mockResolvedValue({ slug: "free", usage: { avulsoBalance: 12 } });
    const onPaid = vi.fn();
    open({ kind: "avulso", units: 10 }, vi.fn(), { onPaid, pollMs: 5 });
    fireEvent.click(screen.getByText("Continuar"));
    expect(await screen.findByText("Pagamento confirmado")).toBeTruthy();
    expect(screen.getByText("Suas 10 notas avulsas já estão no saldo.")).toBeTruthy();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it("detects a plan purchase when the account switches to that plan", async () => {
    purchase.mockResolvedValue({ method: "pix", brCode: "BR", qrCodeImage: null, paymentLinkUrl: "https://woovi.test/p", expiresAt: null });
    plan.mockResolvedValueOnce({ slug: "free", usage: { avulsoBalance: 0 } }).mockResolvedValue({ slug: "equipe", usage: { avulsoBalance: 0 } });
    open({ kind: "plan", slug: "equipe", cycle: "annual" }, vi.fn(), { pollMs: 5 });
    fireEvent.click(screen.getByText("Continuar"));
    expect(await screen.findByText("Pagamento confirmado")).toBeTruthy();
    expect(screen.getByText("Seu plano EQUIPE está ativo.")).toBeTruthy();
  });

  it("keeps the dialog and the typed data when the provider rejects the request, showing its reason", async () => {
    purchase.mockRejectedValueOnce(new ApiError(400, "Woovi: taxID inválido", "ERROR_PIX_PROVIDER_ERROR"));
    const onError = vi.fn();
    open({ kind: "avulso", units: 5 }, vi.fn(), { onError });
    fireEvent.click(screen.getByText("Continuar"));
    expect((await screen.findByRole("alert")).textContent).toContain(pt.ApiErrors.pix_provider_error);
    expect(onError).not.toHaveBeenCalled();
    // Still on the form: the choices are there and the button works again for a retry.
    expect(screen.getByTestId("method-pix")).toBeTruthy();
    purchase.mockResolvedValueOnce({ method: "pix", brCode: "BR", qrCodeImage: null, paymentLinkUrl: "https://woovi.test/p", expiresAt: null });
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(screen.getByTestId("pix-result")).toBeTruthy());
  });

  it("hands server failures (5xx) to the page toast instead of the inline message", async () => {
    purchase.mockRejectedValueOnce(new ApiError(502, "Upstream service unavailable"));
    const onError = vi.fn();
    open({ kind: "avulso", units: 5 }, vi.fn(), { onError });
    fireEvent.click(screen.getByText("Continuar"));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it("resumes a Pix that is waiting: shows its QR again with no new purchase, and watches for the plan", async () => {
    plan.mockResolvedValue({ slug: "free", usage: { avulsoBalance: 0 } });
    const onPaid = vi.fn();
    open({ kind: "plan", slug: "equipe", cycle: "monthly" }, vi.fn(), { resume: { brCode: "000201EMV", paymentLinkUrl: "https://woovi.test/p" }, onPaid, pollMs: 5 });
    expect((await screen.findByAltText("Pix QR Code")).getAttribute("src")).toMatch(/^data:image\//);
    expect(purchase).not.toHaveBeenCalled();
    expect(screen.queryByText("Continuar")).toBeNull();
    // The payer approves in the bank app: the account is now on the plan.
    plan.mockResolvedValue({ slug: "equipe", usage: { avulsoBalance: 0 } });
    expect(await screen.findByText("Pagamento confirmado")).toBeTruthy();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });
});
