import { describe, expect, it } from "vitest";
import { effectiveFiscalProfiles, isSimpleNational, fiscalToday, resolveServiceState } from "@/lib/company-fiscal";
import type { CompanyFiscalProfile, CompanyServiceTaxProfile } from "@/lib/types";

const profile = { id: "old", validFrom: "2026-01-01", validUntil: "2026-10-20" } as CompanyFiscalProfile;
describe("company fiscal configuration", () => {
  it("uses inclusive starts and exclusive ends, not the newest future profile", () => {
    const future = { ...profile, id: "future", validFrom: "2026-10-20", validUntil: null };
    expect(effectiveFiscalProfiles([profile, future], "2026-10-19")).toEqual([profile]);
    expect(effectiveFiscalProfiles([profile, future], "2026-10-20")).toEqual([future]);
    expect(effectiveFiscalProfiles([future], "2026-10-19")).toEqual([]);
    expect(effectiveFiscalProfiles([profile, { ...profile, id: "overlap" }], "2026-10-19")).toHaveLength(2);
  });
  it("keeps the Simples flag coherent with the selected regime", () => {
    expect(isSimpleNational("MEI")).toBe(true);
    expect(isSimpleNational("Simples Nacional")).toBe(true);
    expect(isSimpleNational("SIMPLES_NACIONAL")).toBe(true);
    expect(isSimpleNational("Lucro Real")).toBe(false);
  });
  it("uses the fiscal timezone near UTC midnight", () => {
    expect(fiscalToday(new Date("2026-10-16T01:00:00Z"))).toBe("2026-10-15");
  });
  it("distinguishes missing, unreviewed, approved and ambiguous service configuration", () => {
    const service = { id: "service", serviceCode: "010601", reviewStatus: "unreviewed", effectiveFrom: "2026-01-01", effectiveUntil: null, regimeApplicability: [] } as unknown as CompanyServiceTaxProfile;
    expect(resolveServiceState([], "010601", "2026-10-15", "MEI")).toBe("missing");
    expect(resolveServiceState([service], "010601", "2026-10-15", "MEI")).toBe("unreviewed");
    expect(resolveServiceState([{ ...service, reviewStatus: "approved" }], "010601", "2026-10-15", "MEI")).toBe("approved");
    expect(resolveServiceState([service, { ...service, id: "duplicate" }], "010601", "2026-10-15", "MEI")).toBe("ambiguous");
    expect(resolveServiceState([{ ...service, regimeApplicability: ["LUCRO_REAL"] }], "010601", "2026-10-15", "MEI")).toBe("missing");
  });
});
