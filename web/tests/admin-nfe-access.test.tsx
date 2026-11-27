// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NfeAccessButton } from "@/components/admin/nfe-access-button";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ set: vi.fn(), setNfce: vi.fn() }));
vi.mock("@/lib/platform-admin", async (original) => ({ ...(await original<typeof import("@/lib/platform-admin")>()), platformAdmin: { setNfeAccess: mocks.set, setNfceAccess: mocks.setNfce } }));

const renderButton = (enabledAt: string | null, onChanged = vi.fn(), type?: "nfe" | "nfce") => {
  render(<NextIntlClientProvider locale="en" messages={messages}><NfeAccessButton tenantId="t1" enabledAt={enabledAt} type={type} onChanged={onChanged} /></NextIntlClientProvider>);
  return onChanged;
};
const submitButton = (name: string) => Array.from(screen.getByRole("dialog").querySelectorAll("button")).find((b) => b.textContent === name)!;

beforeEach(() => { vi.clearAllMocks(); mocks.set.mockResolvedValue({ tenantId: "t1", enabled: true, enabledAt: "2026-11-26T12:00:00Z" }); mocks.setNfce.mockResolvedValue({ tenantId: "t1", enabled: true, enabledAt: "2026-11-26T12:00:00Z" }); });
afterEach(cleanup);

describe("Admin NF-e release button", () => {
  it("off: offers to release, asks for a reason and sends enabled true", async () => {
    const onChanged = renderButton(null);
    expect(screen.getByText("NF-e is not released for this account yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Release NF-e" }));
    await screen.findByRole("dialog");
    fireEvent.click(submitButton("Release NF-e"));
    await screen.findByText("The reason must have 5 to 500 characters.");
    expect(mocks.set).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Teste do dono em homologação" } });
    fireEvent.click(submitButton("Release NF-e"));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("t1", { enabled: true, reason: "Teste do dono em homologação" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("on: offers to turn it off and sends enabled false", async () => {
    renderButton("2026-11-26T12:00:00Z");
    expect(screen.getByText("NF-e is released for this account.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn NF-e off" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Fim do período de teste" } });
    fireEvent.click(submitButton("Turn NF-e off"));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("t1", { enabled: false, reason: "Fim do período de teste" }));
  });

  it("shows the error and keeps the dialog open when the API refuses", async () => {
    mocks.set.mockRejectedValue(new ApiError(404, "nf"));
    const onChanged = renderButton(null);
    fireEvent.click(screen.getByRole("button", { name: "Release NF-e" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Teste do dono em homologação" } });
    fireEvent.click(submitButton("Release NF-e"));
    await screen.findByText("This workspace was not found.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("NFC-e: has its own switch, texts and call", async () => {
    const onChanged = renderButton(null, vi.fn(), "nfce");
    expect(screen.getByText("NFC-e is not released for this account yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Release NFC-e" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Teste do dono em homologação" } });
    fireEvent.click(submitButton("Release NFC-e"));
    await waitFor(() => expect(mocks.setNfce).toHaveBeenCalledWith("t1", { enabled: true, reason: "Teste do dono em homologação" }));
    expect(mocks.set).not.toHaveBeenCalled();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
