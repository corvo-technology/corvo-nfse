// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileNamePrompt } from "@/components/profile/name-prompt";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  refreshSession: vi.fn(),
  profile: { name: "", email: "maria99@example.com" } as { name: string; email: string } | null,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  auth: { updateProfile: mocks.updateProfile },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ profile: mocks.profile, session: { context: { authUserId: "u1" } }, refreshSession: mocks.refreshSession }),
}));

const renderPrompt = () => render(<NextIntlClientProvider locale="en" messages={messages}><ProfileNamePrompt /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.profile = { name: "", email: "maria99@example.com" };
  mocks.updateProfile.mockResolvedValue({ name: "Maria Souza" });
  mocks.refreshSession.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("first-access name screen", () => {
  it("asks for the name when the account has none", () => {
    renderPrompt();
    expect(screen.getByRole("heading", { name: "What should we call you?" })).toBeTruthy();
  });

  it("asks again for the name that was only taken from the e-mail", () => {
    mocks.profile = { name: "maria99", email: "maria99@example.com" };
    renderPrompt();
    expect(screen.getByRole("heading", { name: "What should we call you?" })).toBeTruthy();
  });

  it("stays out of the way when the person already has a real name", () => {
    mocks.profile = { name: "Maria Souza", email: "maria99@example.com" };
    renderPrompt();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("saves the trimmed name and reloads the session", async () => {
    renderPrompt();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "  Maria Souza " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mocks.refreshSession).toHaveBeenCalled());
    expect(mocks.updateProfile).toHaveBeenCalledWith("Maria Souza");
  });

  it("does not send an empty name", () => {
    renderPrompt();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the screen when saving fails", async () => {
    mocks.updateProfile.mockRejectedValue(new Error("boom"));
    renderPrompt();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { name: "What should we call you?" })).toBeTruthy();
  });

  it("can be skipped, and stays skipped for the rest of the browser session", () => {
    const first = renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("heading")).toBeNull();
    first.unmount();
    renderPrompt();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
