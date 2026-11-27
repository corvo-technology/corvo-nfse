// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SvcContingency } from "@/components/admin/svc-contingency";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ states: vi.fn(), exit: vi.fn() }));
vi.mock("@/lib/platform-admin", async (original) => ({ ...(await original<typeof import("@/lib/platform-admin")>()), platformAdmin: { svcStates: mocks.states, exitSvc: mocks.exit } }));

const SP = { uf: "SP", tpAmb: 2, authority: "SVCAN", enteredAt: "2026-11-26T15:00:00Z", dhCont: "2026-11-26T12:00:00-03:00" };
const AM = { uf: "AM", tpAmb: 1, authority: "SVCRS", enteredAt: null, dhCont: null };

const renderIt = () => render(<NextIntlClientProvider locale="en" messages={messages}><SvcContingency /></NextIntlClientProvider>);
const submitButton = (name: string) => Array.from(screen.getByRole("dialog").querySelectorAll("button")).find((b) => b.textContent === name)!;

beforeEach(() => { vi.clearAllMocks(); mocks.states.mockResolvedValue([SP, AM]); mocks.exit.mockResolvedValue({ uf: "SP", tpAmb: 2, mode: "none" }); });
afterEach(cleanup);

describe("Admin SVC contingency", () => {
  it("lists the UFs that are in the SVC with the authority of each", async () => {
    renderIt();
    await screen.findByText(/SP · Homologation/);
    expect(screen.getByText(/AM · Production/)).toBeTruthy();
    expect(screen.getByText(/Virtual SEFAZ: SVC-AN/)).toBeTruthy();
    expect(screen.getByText(/Virtual SEFAZ: SVC-RS/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Leave the SVC" })).toHaveLength(2);
  });

  it("says so when no state is in contingency", async () => {
    mocks.states.mockResolvedValue([]);
    renderIt();
    await screen.findByText(/No state is in contingency/);
  });

  it("asks for a reason, sends it for that UF and environment, and reloads the list", async () => {
    renderIt();
    await screen.findByText(/SP · Homologation/);
    fireEvent.click(screen.getAllByRole("button", { name: "Leave the SVC" })[0]);
    await screen.findByRole("dialog");
    fireEvent.click(submitButton("Leave the SVC"));
    await screen.findByText("The reason must have 5 to 500 characters.");
    expect(mocks.exit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "A SEFAZ de SP voltou" } });
    mocks.states.mockResolvedValue([AM]);
    fireEvent.click(submitButton("Leave the SVC"));
    await waitFor(() => expect(mocks.exit).toHaveBeenCalledWith("SP", 2, { reason: "A SEFAZ de SP voltou" }));
    await waitFor(() => expect(screen.queryByText(/SP · Homologation/)).toBeNull());
  });

  it("keeps the dialog open and shows the error when the state is gone", async () => {
    mocks.exit.mockRejectedValue(new ApiError(404, "nf"));
    renderIt();
    await screen.findByText(/SP · Homologation/);
    fireEvent.click(screen.getAllByRole("button", { name: "Leave the SVC" })[0]);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "A SEFAZ de SP voltou" } });
    fireEvent.click(submitButton("Leave the SVC"));
    await screen.findByText("That state is no longer in contingency.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
