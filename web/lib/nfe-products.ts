import { useCallback, useEffect, useState } from "react";
import { productFavorites } from "./api";
import { toMoneyText, toNumber, type NfeItemForm } from "./nfe-form";
import type { ProductFavorite, ProductFavoriteInput } from "./types";

/** The fields of a note item that a saved product fills. */
export type SavedProduct = Pick<NfeItemForm, "code" | "description" | "ncm" | "cfop" | "unit" | "unitPrice" | "csosn">;

/** The old list, kept in this browser before the catalog moved to the server. */
export const LOCAL_PRODUCTS_KEY = "corvo.nfe.products";

export function toItemFields(product: ProductFavorite): SavedProduct {
  return { code: product.code, description: product.description, ncm: product.ncm, cfop: product.cfop ?? "", unit: product.unit, unitPrice: toMoneyText(product.unitPrice), csosn: product.csosn ?? "" };
}

/** What the API needs to save an item as a product, or null while the item lacks a name or a valid NCM. */
export function toProductInput(item: SavedProduct): ProductFavoriteInput | null {
  const description = item.description.trim();
  const ncm = item.ncm.replace(/\D/g, "");
  if (!description || ncm.length !== 8) return null;
  return {
    description: description.slice(0, 120), code: item.code.trim().slice(0, 60), ncm,
    cfop: /^\d{4}$/.test(item.cfop) ? item.cfop : null,
    unit: item.unit.trim().toUpperCase().slice(0, 6) || "UN",
    unitPrice: Math.max(0, toNumber(item.unitPrice)),
    csosn: item.csosn === "102" || item.csosn === "400" ? item.csosn : null,
  };
}

/** Search by name or code, ignoring case and accents. */
export function filterProducts(products: ProductFavorite[], term: string): ProductFavorite[] {
  const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(term.trim());
  return needle ? products.filter((p) => fold(p.description).includes(needle) || fold(p.code).includes(needle)) : products;
}

function readLocalProducts(): SavedProduct[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOCAL_PRODUCTS_KEY) ?? "[]");
    return Array.isArray(value) ? (value as SavedProduct[]).filter((p) => typeof p?.description === "string") : [];
  } catch { return []; }
}

/**
 * Moves the list kept in this browser to the catalog of the company, once. The key is removed only
 * after every product was sent (or could not be valid), so a failure tries again on the next visit.
 * Returns true when something was imported.
 */
export async function importLocalProducts(companyId: string): Promise<boolean> {
  const local = readLocalProducts();
  try {
    if (localStorage.getItem(LOCAL_PRODUCTS_KEY) === null) return false;
  } catch { return false; }
  const inputs = local.map((p) => toProductInput({ code: p.code ?? "", description: p.description, ncm: p.ncm ?? "", cfop: p.cfop ?? "", unit: p.unit ?? "UN", unitPrice: p.unitPrice ?? "0", csosn: p.csosn ?? "" })).filter((i): i is ProductFavoriteInput => i !== null);
  // The oldest first, so the newest ends as the last one saved.
  for (const input of inputs.reverse()) await productFavorites.save(companyId, input);
  try { localStorage.removeItem(LOCAL_PRODUCTS_KEY); } catch { /* blocked storage: nothing to clean */ }
  return inputs.length > 0;
}

/**
 * The saved products of a company. The first load also moves the old browser list to the server.
 * A failed load leaves an empty list: the item fields can always be typed.
 */
export function useProducts(companyId: string) {
  const [state, setState] = useState<{ companyId: string; products: ProductFavorite[] } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    void (async () => {
      try { await importLocalProducts(companyId); } catch { /* kept in the browser: tried again next time */ }
      try {
        const products = await productFavorites.list(companyId, controller.signal);
        if (!controller.signal.aborted) setState({ companyId, products });
      } catch { /* the form works without the catalog */ }
    })();
    return () => controller.abort();
  }, [companyId]);

  const save = useCallback(async (item: SavedProduct): Promise<ProductFavorite | null> => {
    const input = toProductInput(item);
    if (!input || !companyId) return null;
    const saved = await productFavorites.save(companyId, input);
    setState((current) => {
      const others = (current?.companyId === companyId ? current.products : []).filter((p) => p.id !== saved.id);
      return { companyId, products: [...others, saved].sort((a, b) => a.description.localeCompare(b.description)) };
    });
    return saved;
  }, [companyId]);

  return { products: state?.companyId === companyId ? state.products : [], save };
}
