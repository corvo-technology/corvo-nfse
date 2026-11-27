import { describe, expect, it } from "vitest";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";
import { buildLlmsTxt } from "@/lib/llms";

describe("welcome grant copy: 5 free notes", () => {
  it("says 5 on the login tag in both languages", () => {
    expect(JSON.stringify(pt)).toContain('"freeCreditsTag":"5 NOTAS GRÁTIS"');
    expect(JSON.stringify(en)).toContain('"freeCreditsTag":"5 INVOICES FREE"');
  });

  it("never says the first note alone is free", () => {
    const all = JSON.stringify(pt) + JSON.stringify(en);
    expect(all).not.toMatch(/primeira nota é grátis|first invoice is free|primeira nota grátis|first invoice free/i);
  });

  it("states 5 free notes in the Terms of Use", () => {
    expect(JSON.stringify(pt)).toContain("Cada conta recebe 5 notas grátis, uma única vez e sem renovação");
    expect(JSON.stringify(en)).toContain("Every account gets 5 free invoices, once and without renewal");
  });

  it("says 5 in llms.txt", () => {
    expect(buildLlmsTxt("en")).toContain("first 5 invoices are free");
    expect(buildLlmsTxt("pt")).toContain("5 primeiras notas são grátis");
  });
});
