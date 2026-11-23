// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsersPage from "@/app/(dashboard)/app/admin/users/page";
import { CLOUD_DEFAULT_CONFIG } from "@/lib/deployment-config";
import { DeploymentConfigProvider } from "@/lib/deployment-config-context";
import type { PlatformUserRow } from "@/lib/platform-admin";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ users: vi.fn() }));
vi.mock("@/lib/platform-admin", async (original) => ({
  ...(await original<typeof import("@/lib/platform-admin")>()),
  platformAdmin: { users: mocks.users },
}));

const ana: PlatformUserRow = { id: "u-1", email: "ana@example.com", name: "Ana Souza", createdAt: "2026-11-01T12:00:00Z", planSlug: "pro", liveInvoicesThisMonth: 7, avulsoBalance: 12, companiesCount: 2, lastActivityAt: "2026-11-20T12:00:00Z" };
const bia: PlatformUserRow = { ...ana, id: "u-2", email: "bia@example.com", name: "Bia Lima", planSlug: null, lastActivityAt: null };
const page = (items: PlatformUserRow[], nextCursor: string | null = null) => ({ items, hasMore: nextCursor !== null, nextCursor });
const t = messages.Admin.users;

function renderPage(billingEnabled = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeploymentConfigProvider config={{ ...CLOUD_DEFAULT_CONFIG, billingEnabled }}>
        <AdminUsersPage />
      </DeploymentConfigProvider>
    </NextIntlClientProvider>,
  );
}
const table = async () => within(await screen.findByRole("table"));

beforeEach(() => { mocks.users.mockReset(); mocks.users.mockResolvedValue(page([ana, bia])); });
afterEach(cleanup);

describe("Admin users page", () => {
  it("shows the eight columns and links each row to the detail", async () => {
    renderPage();
    const rows = await table();
    for (const label of Object.values(t.columns)) expect(rows.getByRole("columnheader", { name: label })).toBeTruthy();
    expect(rows.getAllByRole("columnheader")).toHaveLength(8);
    expect(rows.getByRole("link", { name: "ana@example.com" }).getAttribute("href")).toBe("/app/admin/users/u-1");
    expect(rows.getByText(t.noPlan)).toBeTruthy();
    expect(mocks.users).toHaveBeenCalledWith({ limit: 50 }, expect.anything());
  });

  it("searches only after the typing pause, with the term trimmed", async () => {
    renderPage();
    await table();
    mocks.users.mockClear();
    mocks.users.mockResolvedValue(page([bia]));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value: " bi" } });
      vi.advanceTimersByTime(200);
      fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value: " bia " } });
      vi.advanceTimersByTime(200);
      expect(mocks.users).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
    } finally { vi.useRealTimers(); }
    await waitFor(() => expect(mocks.users).toHaveBeenCalledTimes(1));
    expect(mocks.users).toHaveBeenLastCalledWith({ limit: 50, search: "bia" }, expect.anything());
  });

  it("ignores a late load-more after the search changes", async () => {
    mocks.users.mockResolvedValueOnce(page([ana], "cur-1"));
    renderPage();
    await table();
    let resolveLate: (value: ReturnType<typeof page>) => void = () => {};
    mocks.users.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.common.loadMore }));
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.common.loadMore }));
    expect(mocks.users).toHaveBeenCalledTimes(2);
    mocks.users.mockResolvedValue(page([bia]));
    fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value: "bia" } });
    await waitFor(() => expect(mocks.users).toHaveBeenLastCalledWith({ limit: 50, search: "bia" }, expect.anything()));
    expect(await within(await screen.findByRole("table")).findByText("bia@example.com")).toBeTruthy();
    resolveLate(page([{ ...ana, id: "u-9", email: "late@example.com" }], "cur-late"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("late@example.com")).toBeNull();
    expect(screen.queryByText("ana@example.com")).toBeNull();
    expect(screen.queryByRole("button", { name: messages.Admin.common.loadMore })).toBeNull();
  });

  it("clears the old rows and cursor when a new search fails", async () => {
    mocks.users.mockResolvedValueOnce(page([ana], "cur-1"));
    renderPage();
    await table();
    mocks.users.mockRejectedValue(new Error("boom"));
    fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value: "zzz" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("ana@example.com")).toBeNull();
    expect(screen.queryByRole("button", { name: messages.Admin.common.loadMore })).toBeNull();
  });

  it("loads more with the next cursor", async () => {
    mocks.users.mockResolvedValueOnce(page([ana], "cur-1"));
    renderPage();
    await table();
    mocks.users.mockResolvedValueOnce(page([bia]));
    fireEvent.click(screen.getByRole("button", { name: messages.Admin.common.loadMore }));
    await waitFor(() => expect(mocks.users).toHaveBeenLastCalledWith({ limit: 50, cursor: "cur-1" }, expect.anything()));
    expect(await within(screen.getByRole("table")).findByText("bia@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: messages.Admin.common.loadMore })).toBeNull();
  });

  it("shows the empty state", async () => {
    mocks.users.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText(t.noResults)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("hides plan and avulso balance columns when self-hosted", async () => {
    renderPage(false);
    const rows = await table();
    expect(rows.getAllByRole("columnheader")).toHaveLength(6);
    expect(rows.queryByRole("columnheader", { name: t.columns.plan })).toBeNull();
    expect(rows.queryByRole("columnheader", { name: t.columns.avulsoBalance })).toBeNull();
  });
});
