// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { InvoicePackageButton } from "@/components/invoices/invoice-package-button";
import messages from "@/messages/pt.json";

const mocks = vi.hoisted(() => ({ summary: vi.fn(), download: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { list: mocks.list },
  invoicePackages: { summary: mocks.summary, download: mocks.download },
}));
vi.mock("@/lib/download", () => ({ saveBlob: mocks.save }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup() {
  mocks.list.mockResolvedValue({ items: [{ id: "c-1", taxId: "12345678000190", legalName: "Acme" }], nextCursor: null, hasMore: false });
  return render(
    <NextIntlClientProvider locale="pt" messages={messages}>
      <header className="dash-in"><InvoicePackageButton /></header>
    </NextIntlClientProvider>,
  );
}

it("abre o painel direto no body, fora do cabeçalho animado, para ficar acima dos filtros", async () => {
  const { container } = setup();
  fireEvent.click(screen.getByRole("button", { name: messages.InvoicePackage.button }));
  const dialog = await screen.findByRole("dialog");
  expect(container.contains(dialog)).toBe(false);
  expect(dialog.closest(".dash-in")).toBeNull();
  expect(document.body.contains(dialog)).toBe(true);
});

it("baixa o ZIP do mês escolhido", async () => {
  const blob = new Blob(["zip"]);
  mocks.summary.mockResolvedValue({ month: "2026-11", count: 3, total: "10", limit: 500, companyName: "Acme", companyTaxId: "12345678000190" });
  mocks.download.mockResolvedValue(blob);
  setup();
  fireEvent.click(screen.getByRole("button", { name: messages.InvoicePackage.button }));
  const input = await screen.findByLabelText(messages.InvoicePackage.month);
  fireEvent.change(input, { target: { value: "2026-11" } });
  await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  await waitFor(() => expect((screen.getByRole("button", { name: messages.InvoicePackage.download }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: messages.InvoicePackage.download }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(blob, "nfse-2026-11-12345678000190.zip"));
  expect(mocks.summary).toHaveBeenCalledWith("c-1", "2026-11");
  expect(mocks.download).toHaveBeenCalledWith("c-1", "2026-11");
});
