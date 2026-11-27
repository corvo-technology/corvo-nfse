// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewInvoiceMenu } from "@/components/dashboard/new-invoice-menu";
import messages from "@/messages/en.json";

const auth = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => auth.permissions.includes(permission) }) }));

const renderMenu = () => render(<NextIntlClientProvider locale="en" messages={messages}><NewInvoiceMenu /></NextIntlClientProvider>);
afterEach(() => { cleanup(); auth.permissions = []; });

describe("NewInvoiceMenu", () => {
  it("goes straight to the service invoice form when the member cannot issue NF-e", () => {
    auth.permissions = ["nfse.invoices.issue"];
    renderMenu();
    expect(screen.getByRole("link", { name: /New invoice/ }).getAttribute("href")).toBe("/app/invoices/new");
  });

  it("offers service, product and consumer sale to every member who may issue NF-e, with nothing to release", () => {
    auth.permissions = ["nfse.invoices.issue", "nfe.documents.issue"];
    renderMenu();
    expect(screen.getByText("Service invoice (NFS-e)").getAttribute("href")).toBe("/app/invoices/new");
    expect(screen.getByText("Product invoice (NF-e)").getAttribute("href")).toBe("/app/nfe/new");
    expect(screen.getByText("Consumer sale (NFC-e)").getAttribute("href")).toBe("/app/nfe/new?type=nfce");
  });

  it("shows only the goods notes to a member who cannot issue NFS-e", () => {
    auth.permissions = ["nfe.documents.issue"];
    renderMenu();
    expect(screen.queryByText("Service invoice (NFS-e)")).toBeNull();
    expect(screen.getByText("Product invoice (NF-e)")).toBeTruthy();
  });

  it("shows nothing to a member who can issue neither", () => {
    renderMenu();
    expect(screen.queryByText(/New invoice/)).toBeNull();
  });
});
