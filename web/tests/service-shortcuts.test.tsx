// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceShortcuts } from "@/components/invoices/service-shortcuts";
import type { Invoice, ServiceFavorite } from "@/lib/types";
import messages from "@/messages/pt.json";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), remove: vi.fn(), invoices: vi.fn() }));
vi.mock("@/lib/api", () => ({ serviceFavorites: { list: api.list, create: api.create, remove: api.remove }, invoices: { list: api.invoices } }));

const favorite: ServiceFavorite = { id: "fav-1", companyId: "company-1", label: "Mensalidade", description: "Consultoria mensal", serviceCode: "010101", amountCents: 150000, municipalityCode: "3550308", createdAt: "" };
const lastInvoice = { id: "inv-1", companyId: "company-1", amount: 99.9, customerSnapshot: { taxId: "52998224725", name: "Maria" }, serviceSnapshot: { description: "Aula de violão", code: "080201", municipalityCode: "3304557" } } as unknown as Invoice;
const empty = { description: "", serviceCode: "010101", municipalityCode: "", amountCents: 0 };

function renderShortcuts(props: Partial<React.ComponentProps<typeof ServiceShortcuts>> = {}) {
  const onApply = vi.fn();
  render(
    <NextIntlClientProvider locale="pt" messages={messages}>
      <ServiceShortcuts companyId="company-1" savedCustomerTaxId={null} current={empty} onApply={onApply} {...props} />
    </NextIntlClientProvider>,
  );
  return onApply;
}

beforeEach(() => { api.list.mockResolvedValue([]); api.invoices.mockResolvedValue({ items: [], hasMore: false, nextCursor: null }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ServiceShortcuts", () => {
  it("fills description, code, municipality and amount when a favorite is picked", async () => {
    api.list.mockResolvedValue([favorite]);
    const onApply = renderShortcuts();
    fireEvent.click(await screen.findByRole("button", { name: "Mensalidade" }));
    expect(onApply).toHaveBeenCalledWith({ serviceDescription: "Consultoria mensal", serviceCode: "010101", municipalityCode: "3550308", amount: "1.500,00" });
  });

  it("leaves the amount alone when the favorite has no default amount", async () => {
    api.list.mockResolvedValue([{ ...favorite, amountCents: null, municipalityCode: null }]);
    const onApply = renderShortcuts();
    fireEvent.click(await screen.findByRole("button", { name: "Mensalidade" }));
    expect(onApply).toHaveBeenCalledWith({ serviceDescription: "Consultoria mensal", serviceCode: "010101" });
  });

  it("saves what is in the form as a favorite, with the name the person chose", async () => {
    api.create.mockResolvedValue({ ...favorite, id: "fav-2", label: "Aula" });
    renderShortcuts({ current: { description: "Aula de violão", serviceCode: "080201", municipalityCode: "", amountCents: 9990 } });
    fireEvent.click(await screen.findByRole("button", { name: /Salvar como favorito/ }));
    fireEvent.change(screen.getByLabelText("Nome do favorito"), { target: { value: "Aula" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith("company-1", { label: "Aula", description: "Aula de violão", serviceCode: "080201", amountCents: 9990, municipalityCode: null }));
    expect(await screen.findByRole("button", { name: "Aula" })).toBeTruthy();
  });

  it("does not offer to save an empty description", () => {
    renderShortcuts();
    expect(screen.queryByRole("button", { name: /Salvar como favorito/ })).toBeNull();
  });

  it("removes a favorite from the list", async () => {
    api.list.mockResolvedValue([favorite]);
    api.remove.mockResolvedValue(undefined);
    renderShortcuts();
    fireEvent.click(await screen.findByRole("button", { name: "Remover favorito Mensalidade" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("company-1", "fav-1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mensalidade" })).toBeNull());
  });

  it("offers the last invoice of a saved customer and fills only on click", async () => {
    api.invoices.mockResolvedValue({ items: [lastInvoice], hasMore: false, nextCursor: null });
    const onApply = renderShortcuts({ savedCustomerTaxId: "52998224725" });
    const button = await screen.findByRole("button", { name: "Usar a última nota deste cliente" });
    expect(api.invoices).toHaveBeenCalledWith({ companyId: "company-1", customerTaxId: "52998224725", status: "authorized", limit: 1 });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledWith({ serviceDescription: "Aula de violão", serviceCode: "080201", municipalityCode: "3304557", amount: "99,90" });
  });

  it("shows no last-invoice shortcut for a customer without invoices or without a saved match", async () => {
    renderShortcuts({ savedCustomerTaxId: "52998224725" });
    await waitFor(() => expect(api.invoices).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /última nota/ })).toBeNull();
    cleanup();
    api.invoices.mockClear();
    renderShortcuts({ savedCustomerTaxId: null });
    expect(api.invoices).not.toHaveBeenCalled();
  });
});
