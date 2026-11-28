// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomersPage from "@/app/(dashboard)/app/customers/page";
import type { SavedCustomer } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ canEdit: true, list: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => mocks.canEdit, fiscalEnvironment: "live" }) }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), customers: { list: mocks.list, update: mocks.update, remove: mocks.remove } }));

const acme: SavedCustomer = { taxId: "11222333000181", name: "Acme Ltda", email: "financeiro@acme.test", lastUsedAt: "2026-11-10T12:00:00Z", createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-10T12:00:00Z" };
const maria: SavedCustomer = { taxId: "52998224725", name: "Maria da Silva", email: null, lastUsedAt: "2026-11-09T12:00:00Z", createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-09T12:00:00Z" };
const page = (items: SavedCustomer[]) => ({ items, hasMore: false, nextCursor: null });
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><CustomersPage /></NextIntlClientProvider>);
const t = messages.Customers;
// The list renders a table and, for small screens, the same rows as cards: read the table.
const table = async () => within(await screen.findByRole("table"));

beforeEach(() => { mocks.canEdit = true; mocks.list.mockReset(); mocks.update.mockReset(); mocks.remove.mockReset(); mocks.list.mockResolvedValue(page([acme, maria])); });
afterEach(cleanup);

describe("Customers page", () => {
  it("lists the saved customers with the document formatted", async () => {
    renderPage();
    const rows = await table();
    expect(rows.getByText("Acme Ltda")).toBeTruthy();
    expect(rows.getByText("11.222.333/0001-81")).toBeTruthy();
    expect(rows.getByText("529.982.247-25")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledWith({ limit: 50 }, expect.anything());
  });

  it("searches after the typing stops", async () => {
    renderPage();
    await table();
    mocks.list.mockResolvedValue(page([maria]));
    fireEvent.change(screen.getByLabelText(t.search.label), { target: { value: " maria " } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ limit: 50, search: "maria" }, expect.anything()));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Acme Ltda")).toBeNull());
  });

  it("explains the empty list and points to issuing an invoice", async () => {
    mocks.list.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText(t.empty.title)).toBeTruthy();
    expect(screen.getByRole("link", { name: t.empty.action }).getAttribute("href")).toBe("/app/invoices/new");
  });

  it("corrects the name and clears the email", async () => {
    mocks.update.mockResolvedValue({ ...acme, name: "Acme S.A.", email: null });
    renderPage();
    fireEvent.click((await table()).getByRole("button", { name: "Correct Acme Ltda" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t.columns.name)), { target: { value: " Acme S.A. " } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t.columns.email)), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t.edit.save }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("11222333000181", { name: "Acme S.A.", email: null }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Acme S.A.")).toBeTruthy());
  });

  it("saves the NF-e address and state registration of a customer", async () => {
    mocks.update.mockResolvedValue(acme);
    renderPage();
    fireEvent.click((await table()).getByRole("button", { name: "Correct Acme Ltda" }));
    const dialog = screen.getByRole("dialog");
    const type = (label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${label}(?! IBGE| registration)`)), { target: { value } });
    type(t.edit.zip, "01310100");
    fireEvent.click(within(dialog).getByRole("button", { name: t.edit.save }));
    // Half an address is not sent.
    expect(await within(dialog).findByText(t.edit.addressIncomplete)).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    type(t.edit.street, "Av. Paulista");
    type(t.edit.number, "1000");
    type(t.edit.district, "Bela Vista");
    type(t.edit.city, "São Paulo");
    type(t.edit.state, "sp");
    type(t.edit.cityCode, "3550308");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t.edit.indIeDest}`)), { target: { value: "1" } });
    type(t.edit.stateRegistration, " 111222333444 ");
    fireEvent.click(within(dialog).getByRole("button", { name: t.edit.save }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("11222333000181", {
      name: "Acme Ltda", email: "financeiro@acme.test",
      address: { street: "Av. Paulista", number: "1000", complement: null, district: "Bela Vista", zip: "01310100", cityCode: "3550308", city: "São Paulo", state: "SP" },
      indIeDest: 1, stateRegistration: "111222333444",
    }));
  });

  it("asks before deleting and reloads the list", async () => {
    mocks.remove.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click((await table()).getByRole("button", { name: "Delete Maria da Silva" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue(page([acme]));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t.remove.confirm }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("52998224725"));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Maria da Silva")).toBeNull());
  });

  it("hides correct and delete from a member who can only view", async () => {
    mocks.canEdit = false;
    renderPage();
    await table();
    expect(screen.queryByRole("button", { name: "Correct Acme Ltda" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Acme Ltda" })).toBeNull();
  });
});
