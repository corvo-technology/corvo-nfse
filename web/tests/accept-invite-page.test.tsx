// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AcceptInvitePage from "@/app/(dashboard)/accept-invite/page";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(), accept: vi.fn(), replace: vi.fn(), switchTenant: vi.fn(), logout: vi.fn(), status: "authenticated",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  invitations: { preview: mocks.preview, accept: mocks.accept },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ status: mocks.status, switchTenant: mocks.switchTenant, logout: mocks.logout }),
}));

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><AcceptInvitePage /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = "authenticated";
  sessionStorage.clear();
  window.history.replaceState(null, "", "/accept-invite#token=tok_abc");
});
afterEach(cleanup);

describe("accept invitation page", () => {
  it("moves the token out of the address bar before anything else", async () => {
    mocks.preview.mockResolvedValue({ role: "developer", invitedBy: "Ana" });
    renderPage();
    await screen.findByText(/Ana invited you/);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("tok_abc");
    expect(mocks.preview).toHaveBeenCalledWith("tok_abc");
  });

  it("sends a signed-out visitor to sign in and keeps the token for the way back", async () => {
    mocks.status = "anonymous";
    renderPage();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Faccept-invite"));
    expect(sessionStorage.getItem("corvo_invite_token")).toBe("tok_abc");
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("accepts, switches to the new workspace and forgets the token", async () => {
    mocks.preview.mockResolvedValue({ role: "billing", invitedBy: "" });
    mocks.accept.mockResolvedValue({ tenantId: "t9", role: "billing" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/app"));
    expect(mocks.accept).toHaveBeenCalledWith("tok_abc");
    expect(mocks.switchTenant).toHaveBeenCalledWith("t9");
    expect(sessionStorage.getItem("corvo_invite_token")).toBeNull();
  });

  it("offers to switch accounts when the signed-in e-mail is not the invited one", async () => {
    mocks.preview.mockRejectedValue(new ApiError(403, "no", "INVITATION_EMAIL_MISMATCH"));
    mocks.logout.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText(/different e-mail/);
    fireEvent.click(screen.getByRole("button", { name: "Sign out and use another e-mail" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Faccept-invite"));
    expect(sessionStorage.getItem("corvo_invite_token")).toBe("tok_abc");
  });

  it.each([
    ["INVITATION_EXPIRED", 410, /expired/],
    ["INVITATION_INVALID", 404, /not valid or was already used/],
  ])("explains a %s invitation", async (code, status, text) => {
    mocks.preview.mockRejectedValue(new ApiError(status, "x", code));
    renderPage();
    await screen.findByText(text);
  });

  it("says so when the link has no token", async () => {
    window.history.replaceState(null, "", "/accept-invite");
    renderPage();
    await screen.findByText(/incomplete/);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
