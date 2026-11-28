// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NavLabel } from "@/components/dashboard/sidebar";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

afterEach(cleanup);

describe("sidebar labels with an acronym", () => {
  it("keeps the acronym in parentheses in one piece, so it never breaks as NFS- / e)", () => {
    const { container } = render(<NavLabel text="Notas de serviço (NFS-e)" />);
    const acronym = container.querySelector("span span");
    expect(acronym?.textContent).toBe("(NFS-e)");
    expect(acronym?.className).toContain("whitespace-nowrap");
    expect(container.textContent).toBe("Notas de serviço (NFS-e)");
  });

  it.each([["en", en], ["pt", pt]] as const)("%s: both note labels end in a protected acronym", (_locale, messages) => {
    for (const text of [messages.Sidebar.nav.invoices, messages.Sidebar.nav.nfe]) {
      const { container, unmount } = render(<NavLabel text={text} />);
      expect(container.querySelector(".whitespace-nowrap")?.textContent).toMatch(/^\(NFS?-e\)$/);
      unmount();
    }
  });

  it("leaves a label without parentheses alone", () => {
    const { container } = render(<NavLabel text="Empresas" />);
    expect(container.querySelector("span")).toBeNull();
    expect(container.textContent).toBe("Empresas");
  });
});
