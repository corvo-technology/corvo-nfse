// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlansDialog } from "@/components/onboarding/plans-dialog";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api", () => ({ plans: { list: mocks.list } }));

const quote = (slug: string, name: string, allowance: number, cents: number) => ({ slug, name, monthlyAllowance: allowance, basePriceCents: cents, monthlyEquivalentCents: cents, chargeTotalCents: cents, currency: "BRL" });
const renderDialog = (open = true) => render(<NextIntlClientProvider locale="en" messages={messages}><PlansDialog open={open} onClose={() => undefined} /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ items: [quote("solo", "Solo", 50, 4900), quote("equipe", "Equipe", 300, 14900)], hasMore: false, nextCursor: null }); });
afterEach(cleanup);

describe("PlansDialog", () => {
  it("explains the product and says tests do not use credits", async () => {
    renderDialog();
    await screen.findByText(messages.Onboarding.intro.p1);
    expect(screen.getByText(/without using credits/)).toBeTruthy();
  });

  it("lists the real plans with price and notes per month", async () => {
    renderDialog();
    await screen.findByText("Solo");
    expect(screen.getByText("50 notes per month")).toBeTruthy();
    expect(screen.getByText("R$49.00/month")).toBeTruthy();
    expect(screen.getByText("Equipe")).toBeTruthy();
    expect(screen.getByText("300 notes per month")).toBeTruthy();
  });

  it("without plans (request failed) it still explains, with no error shown", async () => {
    mocks.list.mockRejectedValue(new Error("boom"));
    renderDialog();
    await screen.findByText(messages.Onboarding.intro.p1);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(screen.queryByText("Solo")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not fetch while closed and offers no payment button", async () => {
    renderDialog(false);
    expect(mocks.list).not.toHaveBeenCalled();
    cleanup();
    renderDialog(true);
    await screen.findByText("Solo");
    expect(screen.queryByRole("button", { name: /pay|subscribe|buy/i })).toBeNull();
  });
});
