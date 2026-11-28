"use client";

import { useId, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { filterProducts } from "@/lib/nfe-products";
import type { ProductFavorite } from "@/lib/types";

const MAX_RESULTS = 8;

interface Props {
  products: ProductFavorite[];
  onPick: (product: ProductFavorite) => void;
}

/** Search the saved products by name or code and pick one. */
export function ProductPicker({ products, onPick }: Props) {
  const t = useTranslations("Nfe.form.items");
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const items = filterProducts(products, query).slice(0, MAX_RESULTS);

  const choose = (product: ProductFavorite) => {
    onPick(product);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter" && open && items[active]) { event.preventDefault(); choose(items[active]); }
    else if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); setQuery(""); }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-4" />
        <input
          role="combobox"
          aria-label={t("useSaved")}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${items[active].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="field pl-9"
          placeholder={t("useSaved")}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setQuery(""); }}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label={t("useSaved")} className="absolute left-0 right-0 z-30 mt-1.5 max-h-72 overflow-y-auto overscroll-contain rounded-[11px] border border-border-strong bg-surface p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]">
          {items.length === 0 && <li role="presentation" className="px-3 py-4 text-center text-[13px] text-text-4">{t("noSavedMatch")}</li>}
          {items.map((product, index) => (
            <li
              key={product.id}
              id={`${listId}-${product.id}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => { event.preventDefault(); choose(product); }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline gap-3 rounded-lg px-2.5 py-2 text-[13px] ${index === active ? "bg-active" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate text-text-2">{product.description}</span>
              {product.code && <span className="flex-none font-mono text-[12px] text-text-4">{product.code}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
