// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompaniesPage from "@/app/(dashboard)/app/companies/page";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), manage: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => mocks.manage }) }));
vi.mock("@/lib/api", () => ({ companies: { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), create: vi.fn() } }));
vi.mock("@/components/dashboard/company-form", () => ({ CompanyForm: () => <div data-testid="company-form" /> }));

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={messages}><CompaniesPage /></NextIntlClientProvider>);

beforeEach(() => { mocks.replace.mockReset(); mocks.manage = true; });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("Companies page ?new=1", () => {
  it("opens the form and cleans the URL", () => {
    window.history.replaceState(null, "", "/app/companies?new=1");
    renderPage();
    expect(screen.getByTestId("company-form")).toBeTruthy();
    expect(mocks.replace).toHaveBeenCalledWith("/app/companies");
  });

  it("keeps the form closed without the param", () => {
    renderPage();
    expect(screen.queryByTestId("company-form")).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not open the form without permission, but still cleans the URL", () => {
    mocks.manage = false;
    window.history.replaceState(null, "", "/app/companies?new=1");
    renderPage();
    expect(screen.queryByTestId("company-form")).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/app/companies");
  });
});
