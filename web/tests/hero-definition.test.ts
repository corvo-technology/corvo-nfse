import { describe, expect, it } from "vitest";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

describe("hero citable definition", () => {
  it.each([["pt", pt.Hero], ["en", en.Hero]])("%s names NFS-e, MEI and Simples Nacional", (_, hero) => {
    for (const term of ["NFS-e", "MEI", "Simples Nacional"]) expect(hero.subtitle).toContain(term);
    expect(hero.subtitle).not.toMatch(/AGPL/i);
  });

  it.each([["pt", pt.Hero], ["en", en.Hero]])("%s adds no price to the subtitle", (_, hero) => {
    expect(hero.subtitle).not.toContain("R$");
    expect(hero.subtitle).not.toMatch(/\d/);
  });
});
