// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingCreditsBanner, RecentImports } from "@/components/imports/recent-imports";
import { useRecentImports } from "@/lib/use-recent-imports";
import type { ImportJob } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ list: vi.fn(), env: "live" as "live" | "test" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), imports: { list: mocks.list } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ fiscalEnvironment: mocks.env }) }));

const job = (id: string, status: ImportJob["status"], counters: Partial<ImportJob["counters"]> = {}, fileName = `${id}.csv`): ImportJob => ({
  id, status, fileName, companyId: null, errorCode: null, rowsExpected: null, unknownColumns: [], emitStartedAt: null, emitFinishedAt: null, createdAt: "2026-11-07T12:05:00.000Z",
  counters: { total: 300, valid: 0, invalid: 0, accepted: 0, authorized: 0, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 0, pending: 0, ...counters },
});
/** The two pieces share one fetch, as the page does. */
function Harness() {
  const recent = useRecentImports();
  return <><PendingCreditsBanner recent={recent} /><RecentImports recent={recent} /></>;
}
const show = () => render(<NextIntlClientProvider locale="en" messages={messages}><Harness /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.env = "live"; });
afterEach(cleanup);

describe("RecentImports", () => {
  it("lists earlier imports and links each to its page, fetching once for both pieces", async () => {
    mocks.list.mockResolvedValue([job("a", "done", { authorized: 20, accepted: 20 }, "notas.csv"), job("b", "ready", { valid: 8, total: 10 })]);
    show();
    expect(await screen.findByText("notas.csv")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(10, expect.anything());
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/app/invoices/import?id=a");
    expect(hrefs).toContain("/app/invoices/import?id=b");
  });

  it("names the environment the list belongs to", async () => {
    mocks.list.mockResolvedValue([job("a", "done")]);
    show();
    expect(await screen.findByRole("heading", { name: /recent imports.*production/i })).toBeTruthy();
    cleanup(); mocks.env = "test";
    mocks.list.mockResolvedValue([job("a", "done")]);
    show();
    expect(await screen.findByRole("heading", { name: /recent imports.*test/i })).toBeTruthy();
  });

  it("highlights an import with invoices waiting for credits and invites to continue", async () => {
    mocks.list.mockResolvedValue([job("a", "done", { authorized: 20, accepted: 20, awaitingCredits: 277 })]);
    show();
    expect(await screen.findByText(/277 waiting for credits/i)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /continue/i }).length).toBeGreaterThan(0);
  });

  it("puts a banner on top when imports are waiting for credits, with the money and a way in", async () => {
    mocks.list.mockResolvedValue([job("a", "done", { awaitingCredits: 277, awaitingAmount: 12345.6 }), job("b", "done", { awaitingCredits: 294, awaitingAmount: 100 })]);
    show();
    const banner = await screen.findByTestId("pending-credits-banner");
    expect(banner.textContent).toMatch(/2 imports are waiting for credits/i);
    expect(banner.textContent).toMatch(/571 invoices/i);
    expect(banner.textContent).toMatch(/12,445\.60/);
    expect(banner.querySelector("a")?.getAttribute("href")).toBe("/app/invoices/import?id=a");
  });

  it("shows no banner when nothing waits for credits", async () => {
    mocks.list.mockResolvedValue([job("a", "done", { authorized: 5 })]);
    show();
    await screen.findByText("a.csv");
    expect(screen.queryByTestId("pending-credits-banner")).toBeNull();
  });

  it("describes the other states in plain words", async () => {
    mocks.list.mockResolvedValue([job("p", "processing"), job("f", "failed"), job("r", "ready", { valid: 5 }), job("e", "emitting", { pending: 3 })]);
    show();
    await screen.findByText("p.csv");
    for (const text of [/reading/i, /could not be read/i, /ready to review/i, /issuing/i]) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it("says there is nothing yet, naming the environment, instead of disappearing", async () => {
    mocks.list.mockResolvedValue([]);
    show();
    expect(await screen.findByText(/no imports in production yet/i)).toBeTruthy();
    expect(screen.getByText(/switch the environment/i)).toBeTruthy();
  });

  it("shows an error with a retry instead of disappearing, and recovers", async () => {
    mocks.list.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([job("a", "done")]);
    show();
    expect(await screen.findByText(/could not load the imports/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("a.csv")).toBeTruthy();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });
});
