import { describe, expect, it } from "vitest";
import { getDocsTree } from "@/lib/docs/registry";

const text = (blocks: unknown[]) => JSON.stringify(blocks);

describe("docs quickstart", () => {
  for (const locale of ["en", "pt"] as const) {
    it(`goes from signup to the first invoice in ${locale}`, () => {
      const tree = getDocsTree(locale)!;
      const home = text(tree.home.blocks);
      const quickstart = home.slice(home.indexOf("Quickstart"), home.indexOf("BASE_URL` (`"));
      expect(quickstart).toContain("/login?mode=signup");
      expect(quickstart).toContain("corvo_test_");
      expect(quickstart).toContain("POST /v1/companies");
      expect(quickstart).toContain("POST /v1/invoices");
      expect(quickstart).toContain("202");
      expect(quickstart).toContain("queued");
      expect(quickstart).toContain("corvo_live_");
      // Required fields of CreateCompanyDto (api/src/modules/company/http/company.dto.ts).
      for (const field of ["legalName", "taxId", "taxRegime", "municipalityCode"]) expect(quickstart).toContain(field);
    });

    it(`says the A1 certificate can be sent by dashboard or API in ${locale}`, () => {
      const page = text(getDocsTree(locale)!.pages.certificates.blocks);
      expect(page).toMatch(locale === "pt" ? /pelo painel.*pela API/ : /dashboard.*API/);
    });
  }
});
