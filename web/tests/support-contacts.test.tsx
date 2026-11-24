// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarHelp, SupportMenu, SupportPills } from "@/components/support/support-contacts";
import { SupportContactsProvider } from "@/lib/support-contacts-context";
import { readSupportContacts, type SupportContacts } from "@/lib/support-contacts";
import pt from "@/messages/pt.json";

afterEach(cleanup);

const all = readSupportContacts({
  SUPPORT_WHATSAPP_NUMBER: "+55 (51) 99999-9999",
  SUPPORT_WHATSAPP_MESSAGE: "Oi, tudo bem? Preciso & ajuda",
  SUPPORT_EMAIL: "suporte@corvo.tech",
  COMMUNITY_WHATSAPP_URL: "https://chat.whatsapp.com/ABC123",
});

function wrap(contacts: SupportContacts, ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <SupportContactsProvider contacts={contacts}>{ui}</SupportContactsProvider>
    </NextIntlClientProvider>,
  );
}

describe("readSupportContacts", () => {
  it("builds a wa.me link with only digits and an encoded message", () => {
    expect(all.whatsappUrl).toBe(`https://wa.me/5551999999999?text=${encodeURIComponent("Oi, tudo bem? Preciso & ajuda")}`);
  });

  it("uses the default message", () => {
    const c = readSupportContacts({ SUPPORT_WHATSAPP_NUMBER: "5551999999999" });
    expect(c.whatsappUrl).toBe(`https://wa.me/5551999999999?text=${encodeURIComponent("Olá! Preciso de ajuda com a Corvo.")}`);
  });

  it("ignores invalid values and warns", () => {
    const warn = vi.fn();
    const c = readSupportContacts(
      { SUPPORT_WHATSAPP_NUMBER: "abc", SUPPORT_EMAIL: "nao-e-email", COMMUNITY_WHATSAPP_URL: "https://evil.example/x", SUPPORT_AVATAR_URL: "http://x/y.png" },
      warn,
    );
    expect(c).toEqual({ whatsappUrl: null, communityUrl: null, email: null, avatarUrl: null });
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("accepts a wa.me group link", () => {
    expect(readSupportContacts({ COMMUNITY_WHATSAPP_URL: "https://wa.me/channel/abc" }).communityUrl).toBe("https://wa.me/channel/abc");
  });
});

describe("support UI", () => {
  it("shows both pills opening in a new tab", () => {
    wrap(all, <SupportPills />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("https://chat.whatsapp.com/ABC123");
    expect(links[1].getAttribute("href")).toBe(all.whatsappUrl);
    for (const l of links) {
      expect(l.getAttribute("target")).toBe("_blank");
      expect(l.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(screen.getByText("Grupo no WhatsApp")).toBeTruthy();
  });

  it("renders nothing when no variable is set", () => {
    const none = readSupportContacts({});
    const { container } = wrap(none, <><SupportPills /><SupportMenu /><SidebarHelp /></>);
    expect(container.innerHTML).toBe("");
  });

  it("does not show a pill for an invalid number", () => {
    const c = readSupportContacts({ SUPPORT_WHATSAPP_NUMBER: "abc" }, () => {});
    const { container } = wrap(c, <SupportPills />);
    expect(container.innerHTML).toBe("");
  });

  it("menu lists WhatsApp, group and mailto e-mail", () => {
    wrap(all, <SupportMenu />);
    fireEvent.click(screen.getByRole("button", { name: /Ajuda/ }));
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([all.whatsappUrl, "https://chat.whatsapp.com/ABC123", "mailto:suporte@corvo.tech"]);
  });

  it("sidebar entry shows only e-mail when it is the only contact", () => {
    wrap(readSupportContacts({ SUPPORT_EMAIL: "a@b.co" }), <SidebarHelp />);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["mailto:a@b.co"]);
  });
});
