// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { CustomerPicker } from "@/components/invoices/customer-picker";
import type { SavedCustomer } from "@/lib/types";
import pt from "@/messages/pt.json";

const list = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ customers: { list } }));

const maria: SavedCustomer = { taxId: "52998224725", name: "Maria da Silva", email: "maria@exemplo.test", lastUsedAt: "", createdAt: "", updatedAt: "" };
const acme: SavedCustomer = { taxId: "11222333000181", name: "Acme Ltda", email: null, lastUsedAt: "", createdAt: "", updatedAt: "" };
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400); }); };
const setup = (onPick = vi.fn()) => {
  render(<NextIntlClientProvider locale="pt" messages={pt}><CustomerPicker id="picker" onPick={onPick} /></NextIntlClientProvider>);
  return { onPick, input: screen.getByRole("combobox") };
};

describe("CustomerPicker", () => {
  beforeEach(() => { vi.useFakeTimers(); list.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("searches by what is typed and picks a customer with the mouse", async () => {
    list.mockResolvedValue({ items: [maria, acme], hasMore: false, nextCursor: null });
    const { onPick, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "acme" } });
    await flush();
    expect(list.mock.calls.at(-1)![0]).toEqual({ search: "acme", limit: 8 });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Acme Ltda/ }));
    expect(onPick).toHaveBeenCalledWith(acme);
  });

  it("picks with the keyboard", async () => {
    list.mockResolvedValue({ items: [maria, acme], hasMore: false, nextCursor: null });
    const { onPick, input } = setup();
    fireEvent.focus(input);
    await flush();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(acme);
  });

  it("says so when nothing matches or the search fails", async () => {
    list.mockResolvedValueOnce({ items: [], hasMore: false, nextCursor: null });
    const { input } = setup();
    fireEvent.focus(input);
    await flush();
    expect(screen.getByText(/Nenhum cliente salvo/)).toBeTruthy();
    list.mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(input, { target: { value: "zzz" } });
    await flush();
    expect(screen.getByText(/Nenhum cliente salvo/)).toBeTruthy();
  });
});
