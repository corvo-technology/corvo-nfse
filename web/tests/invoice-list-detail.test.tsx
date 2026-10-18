// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { InvoiceTable } from "@/components/dashboard/invoice-table";
import type { Invoice } from "@/lib/types";
import messages from "@/messages/en.json";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const auth = vi.hoisted(() => ({ canIssue: true }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => permission !== "nfse.invoices.issue" || auth.canIssue }) }));

afterEach(cleanup);

const invoice = (over: Partial<Invoice> = {}) =>
  ({ id: "inv-1", customerName: "Padaria Estrela", amount: 450, status: "authorized", createdAt: "2026-10-16T12:00:00.000Z", externalId: null, ...over }) as unknown as Invoice;

const renderTable = (invoices: Invoice[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InvoiceTable invoices={invoices} emptyText="none" timeAgoT={((key: string) => key) as never} />
    </NextIntlClientProvider>,
  );

describe("invoice list", () => {
  it("has a view action per invoice that opens its detail page, like the companies list", () => {
    renderTable([invoice(), invoice({ id: "inv-2", customerName: "" })]);

    // The table renders a desktop and a mobile layout, so each action appears in both.
    const first = screen.getAllByRole("link", { name: "View details for Padaria Estrela" });
    expect(first.length).toBeGreaterThan(0);
    for (const link of first) expect(link.getAttribute("href")).toBe("/app/invoices/inv-1");

    const second = screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/app/invoices/inv-2" && link.getAttribute("aria-label"));
    expect(second.length).toBeGreaterThan(0);
  });
});

describe("invoice list duplicate action", () => {
  it("links each invoice to the new-invoice form pre-filled from it", () => {
    auth.canIssue = true;
    renderTable([invoice()]);
    const links = screen.getAllByRole("link", { name: "Duplicate invoice for Padaria Estrela" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("href")).toBe("/app/invoices/new?from=inv-1");
  });
  it("hides the duplicate action from users who cannot issue invoices", () => {
    auth.canIssue = false;
    renderTable([invoice()]);
    expect(screen.queryAllByRole("link", { name: /Duplicate invoice/ })).toHaveLength(0);
    auth.canIssue = true;
  });
});

describe("detail skeleton", () => {
  it("is announced as a busy status and is not just a line of text", () => {
    const { container } = render(<DetailSkeleton label="Loading company" />);

    const status = screen.getByRole("status", { name: "Loading company" });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(8);
    expect(screen.queryByText("Loading company")).toBeNull();
  });
});
