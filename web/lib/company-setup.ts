import type { Company } from "./types";

export type SetupKey = "address" | "municipalityCode" | "certificate";
export interface SetupItem { key: SetupKey; done: boolean; /** The API reports this as blocking (municipal registration only blocks live). */ blocking: boolean }
export interface CompanySetup { items: SetupItem[]; done: number; total: number; allDone: boolean }

/**
 * Checklist built from the API's `setupGaps` + `status`. The API decides what
 * blocks readiness; the address item is a recommendation only.
 */
export function companySetup(company: Company): CompanySetup {
  const gaps = company.setupGaps ?? [];
  const items: SetupItem[] = [
    { key: "address", done: Boolean(company.address.city && company.address.state), blocking: false },
    { key: "municipalityCode", done: /^\d{7}$/.test(company.municipalityCode ?? ""), blocking: gaps.includes("municipality_code") },
    { key: "certificate", done: !gaps.includes("certificate"), blocking: gaps.includes("certificate") },
  ];
  const done = items.filter((item) => item.done).length;
  return { items, done, total: items.length, allDone: done === items.length };
}
