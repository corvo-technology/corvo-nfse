import type { NfeItemForm } from "./nfe-form";

/** A product the person already put on a note, kept in this browser so the next note is quicker. */
export type SavedProduct = Pick<NfeItemForm, "code" | "description" | "ncm" | "cfop" | "unit" | "unitPrice" | "csosn">;

const KEY = "corvo.nfe.products";
const MAX = 20;

export function loadProducts(): SavedProduct[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? (value as SavedProduct[]).filter((p) => typeof p?.description === "string").slice(0, MAX) : [];
  } catch { return []; }
}

/** The most recent first; the same description is kept once. Blocked storage is ignored. */
export function rememberProducts(items: NfeItemForm[]): void {
  try {
    const fresh = items
      .filter((i) => i.description.trim() !== "")
      .map((i): SavedProduct => ({ code: i.code, description: i.description.trim(), ncm: i.ncm, cfop: i.cfop, unit: i.unit, unitPrice: i.unitPrice, csosn: i.csosn }));
    const seen = new Set<string>();
    const all = [...fresh, ...loadProducts()].filter((p) => {
      const key = p.description.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
  } catch { /* private window or blocked storage: nothing is remembered */ }
}
