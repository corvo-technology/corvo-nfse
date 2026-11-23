// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminNav } from "@/components/admin/admin-nav";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

const mocks = vi.hoisted(() => ({ pathname: "/app/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

function setup(pathname: string) {
  mocks.pathname = pathname;
  return render(<NextIntlClientProvider locale="en" messages={en}><AdminNav /></NextIntlClientProvider>);
}
afterEach(cleanup);

describe("AdminNav", () => {
  it("shows the four sections as links", () => {
    setup("/app/admin");
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/app/admin", "/app/admin/users", "/app/admin/attention", "/app/admin/audit"]);
    expect(links.map((a) => a.textContent)).toEqual([en.Admin.nav.overview, en.Admin.nav.users, en.Admin.nav.attention, en.Admin.nav.audit]);
  });

  it.each([
    ["/app/admin", en.Admin.nav.overview],
    ["/app/admin/users", en.Admin.nav.users],
    ["/app/admin/users/u-1", en.Admin.nav.users],
    ["/app/admin/attention", en.Admin.nav.attention],
    ["/app/admin/audit", en.Admin.nav.audit],
  ])("marks the active tab for %s", (path, label) => {
    setup(path);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual([label]);
  });
});

describe("Admin plurals", () => {
  type Translate = (key: string, values: Record<string, unknown>) => string;
  const cases: { ns: string; key: string; arg: string; extra: Record<string, unknown>; kind: "unit" | "fail" }[] = [
    { ns: "overview", key: "units", arg: "count", extra: {}, kind: "unit" },
    { ns: "grant", key: "confirm", arg: "amount", extra: { email: "a@b.c" }, kind: "unit" },
    { ns: "grant", key: "success", arg: "balance", extra: {}, kind: "unit" },
    { ns: "grant", key: "successReplayed", arg: "balance", extra: {}, kind: "unit" },
    { ns: "attention", key: "failedCount", arg: "count", extra: {}, kind: "fail" },
  ];

  it.each([["en", en], ["pt", pt]] as const)("reads 0, 1 and 2 correctly in %s", (locale, messages) => {
    const words = locale === "pt"
      ? { unit: ["nota", "notas"], fail: ["falha", "falhas"] }
      : { unit: ["invoice", "invoices"], fail: ["failure", "failures"] };
    for (const { ns, key, arg, extra, kind } of cases) {
      const translate = createTranslator({ locale, messages, namespace: `Admin.${ns}` }) as unknown as Translate;
      const [singular, plural] = words[kind];
      expect(translate(key, { ...extra, [arg]: 0 })).toContain(`0 ${plural}`);
      expect(translate(key, { ...extra, [arg]: 1 })).toContain(`1 ${singular}`);
      expect(translate(key, { ...extra, [arg]: 2 })).toContain(`2 ${plural}`);
    }
  });

  it("uses no `one {` plural anywhere in the Admin texts", () => {
    expect(JSON.stringify(pt.Admin) + JSON.stringify(en.Admin)).not.toMatch(/\bone \{/);
  });
});
