// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountantPackageCard } from "@/components/companies/accountant-package-card";
import messages from "@/messages/pt.json";

const mocks = vi.hoisted(() => ({ accountant: vi.fn(), setAccountant: vi.fn(), sends: vi.fn(), summary: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  invoicePackages: { accountant: mocks.accountant, setAccountant: mocks.setAccountant, accountantSends: mocks.sends, summary: mocks.summary, sendToAccountant: mocks.send },
}));

const renderCard = (canManage = true) => render(<NextIntlClientProvider locale="pt" messages={messages}><AccountantPackageCard companyId="c1" canManage={canManage} environment="live" /></NextIntlClientProvider>);
const summary = (count: number) => ({ month: "2026-10", count, total: "1234.50", limit: 500, companyName: "Acme", companyTaxId: "11222333000181" });
const record = (over: Record<string, unknown>) => ({ id: "s1", month: "2026-10", recipient: "contador@example.com", invoiceCount: 42, totalCents: 123450, status: "sent", trigger: "scheduled", createdAt: "2026-11-01T11:03:00.000Z", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountant.mockResolvedValue({ email: "contador@example.com", lastSentMonth: null });
  mocks.sends.mockResolvedValue([]);
});
afterEach(cleanup);

async function openConfirmation() {
  renderCard();
  fireEvent.change(await screen.findByLabelText("Mês a enviar"), { target: { value: "2026-10" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar agora ao contador" }));
  return await screen.findByRole("dialog");
}

describe("AccountantPackageCard history", () => {
  it("lists a sent month in plain words, a skipped month and a failure", async () => {
    mocks.sends.mockResolvedValue([
      record({}),
      record({ id: "s2", month: "2026-09", status: "skipped-empty", invoiceCount: 0 }),
      record({ id: "s3", month: "2026-08", status: "skipped-too-large", invoiceCount: 700 }),
      record({ id: "s4", month: "2026-07", status: "failed", invoiceCount: 0 }),
    ]);
    renderCard();
    await screen.findByText("Outubro/2026 — enviado em 01/11 às 08:03 para contador@example.com — 42 notas");
    screen.getByText("Setembro/2026 — não enviado: não houve notas no mês");
    screen.getByText(/Agosto\/2026 — não enviado: o mês teve 700 notas/);
    screen.getByText(/Julho\/2026 — não conseguimos enviar em 01\/11 às 08:03/);
    screen.getByText(/Não garantimos que chegou/);
  });

  it("shows no history block when nothing was attempted", async () => {
    renderCard();
    await screen.findByText("Envio ligado para contador@example.com.");
    expect(screen.queryByText("Últimos envios")).toBeNull();
  });
});

describe("AccountantPackageCard test e-mail", () => {
  it("says a test e-mail went to the new address", async () => {
    mocks.accountant.mockResolvedValue({ email: null, lastSentMonth: null });
    mocks.setAccountant.mockResolvedValue({ email: "novo@example.com", lastSentMonth: null, testEmailSent: true });
    renderCard();
    fireEvent.click(await screen.findByLabelText("Enviar o pacote do mês ao meu contador"));
    fireEvent.change(screen.getByLabelText("E-mail do contador"), { target: { value: "novo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await screen.findByText(/Enviamos um e-mail de teste para esse endereço — confira com seu contador/);
  });

  it("does not mention a test e-mail when the address did not change", async () => {
    mocks.setAccountant.mockResolvedValue({ email: "contador@example.com", lastSentMonth: null, testEmailSent: false });
    renderCard();
    await screen.findByText("Envio ligado para contador@example.com.");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await screen.findByText("Pronto. O pacote será enviado para contador@example.com.");
    expect(screen.queryByText(/e-mail de teste/)).toBeNull();
  });
});

describe("AccountantPackageCard confirmation", () => {
  it("shows month, recipient, count and total, and sends only after confirming", async () => {
    mocks.summary.mockResolvedValue(summary(42));
    mocks.send.mockResolvedValue("sent");
    const dialog = await openConfirmation();
    await within(dialog).findByText(/Mês: Outubro\/2026\. Para: contador@example\.com\. 42 notas, total de/);
    expect(dialog.textContent).toMatch(/R\$\s?1\.234,50/);
    expect(mocks.summary).toHaveBeenCalledWith("c1", "2026-10");
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar agora" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("c1", "2026-10"));
    await screen.findByText("Pronto. Pedimos o envio para contador@example.com.");
  });

  it("does not offer to send a month with no notes", async () => {
    mocks.summary.mockResolvedValue(summary(0));
    const dialog = await openConfirmation();
    await within(dialog).findByText("Não há notas em Outubro/2026, então não há o que enviar.");
    expect(within(dialog).queryByRole("button", { name: "Enviar agora" })).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("explains a month over the limit and does not send", async () => {
    mocks.summary.mockResolvedValue(summary(700));
    const dialog = await openConfirmation();
    await within(dialog).findByText(/Outubro\/2026 tem 700 notas, e um pacote comporta até 500/);
    expect(within(dialog).queryByRole("button", { name: "Enviar agora" })).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("cancel closes without sending", async () => {
    mocks.summary.mockResolvedValue(summary(3));
    const dialog = await openConfirmation();
    await within(dialog).findByText(/3 notas/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
