// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewInvoiceMenu } from "@/components/dashboard/new-invoice-menu";
import messages from "@/messages/en.json";

const auth = vi.hoisted(() => ({ permissions: [] as string[], nfe: false, nfce: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => auth.permissions.includes(permission), features: { nfe: auth.nfe, nfce: auth.nfce } }) }));

const renderMenu = () => render(<NextIntlClientProvider locale="en" messages={messages}><NewInvoiceMenu /></NextIntlClientProvider>);
afterEach(() => { cleanup(); auth.permissions = []; auth.nfe = false; auth.nfce = false; });

describe("NewInvoiceMenu", () => {
  it("goes straight to the service invoice form when NF-e is not released", () => {
    auth.permissions = ["nfse.invoices.issue", "nfe.documents.issue"];
    renderMenu();
    expect(screen.getByRole("link", { name: /New invoice/ }).getAttribute("href")).toBe("/app/invoices/new");
  });

  it("offers a choice between service and product when NF-e is released", () => {
    auth.permissions = ["nfse.invoices.issue", "nfe.documents.issue"];
    auth.nfe = true;
    renderMenu();
    expect(screen.getByText("Service invoice (NFS-e)").getAttribute("href")).toBe("/app/invoices/new");
    expect(screen.getByText("Product invoice (NF-e)").getAttribute("href")).toBe("/app/nfe/new");
  });

  it("shows nothing to a member who can issue neither", () => {
    renderMenu();
    expect(screen.queryByText(/New invoice/)).toBeNull();
  });

  it("offers the consumer sale (NFC-e) when it is released", () => {
    auth.permissions = ["nfse.invoices.issue", "nfe.documents.issue"];
    auth.nfe = true;
    auth.nfce = true;
    renderMenu();
    expect(screen.getByText("Product invoice (NF-e)").getAttribute("href")).toBe("/app/nfe/new");
    expect(screen.getByText("Consumer sale (NFC-e)").getAttribute("href")).toBe("/app/nfe/new?type=nfce");
  });

  it("offers the consumer sale even when only NFC-e is released", () => {
    auth.permissions = ["nfse.invoices.issue", "nfe.documents.issue"];
    auth.nfce = true;
    renderMenu();
    expect(screen.queryByText("Product invoice (NF-e)")).toBeNull();
    expect(screen.getByText("Consumer sale (NFC-e)")).toBeTruthy();
  });
});
