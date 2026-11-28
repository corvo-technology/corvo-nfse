// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductsPage from "@/app/(dashboard)/app/products/page";
import type { ProductFavorite } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn(), companies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true, fiscalEnvironment: "test" }) }));
vi.mock("@/lib/api", async (original) => {
  const api = await original<typeof import("@/lib/api")>();
  return {
    ...api,
    collectAll: async () => mocks.companies(),
    productFavorites: { list: mocks.list, save: vi.fn(), remove: mocks.remove },
  };
});

const product = (id: string, description: string, code: string): ProductFavorite => ({ id, companyId: "c1", description, code, gtin: null, ncm: "61091000", cest: null, cfop: "5102", unit: "UN", unitPrice: 49.9, csosn: null, origin: null, createdAt: "2026-11-01T00:00:00Z" });
const t = messages.Products;
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><ProductsPage /></NextIntlClientProvider>);

beforeEach(() => {
  localStorage.clear();
  mocks.list.mockReset(); mocks.remove.mockReset();
  mocks.companies.mockResolvedValue([{ id: "c1", legalName: "Acme Ltda", tradeName: "Acme" }]);
  mocks.list.mockResolvedValue([product("p1", "Camiseta", "CAM-1"), product("p2", "Calça", "CAL-2")]);
});
afterEach(cleanup);

describe("Products page", () => {
  it("lists the saved products of the company and searches by name or code", async () => {
    renderPage();
    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Camiseta")).toBeTruthy();
    expect(table.getAllByText("6109.10.00")).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledWith("c1", expect.anything());
    fireEvent.change(screen.getByLabelText(t.search.label), { target: { value: "cal-2" } });
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Camiseta")).toBeNull());
    expect(within(screen.getByRole("table")).getByText("Calça")).toBeTruthy();
  });

  it("asks before removing a product", async () => {
    mocks.remove.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(within(await screen.findByRole("table")).getByRole("button", { name: "Delete Camiseta" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t.remove.confirm }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("c1", "p1"));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Camiseta")).toBeNull());
  });

  it("explains the empty list", async () => {
    mocks.list.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(t.empty.title)).toBeTruthy();
  });
});
