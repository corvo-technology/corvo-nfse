"use client";

import { useEffect, useId, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { customers as customersApi } from "@/lib/api";
import { maskTaxId } from "@/lib/masks";
import type { SavedCustomer } from "@/lib/types";

const SEARCH_PAUSE_MS = 250;
const MAX_RESULTS = 8;

interface Props {
  id: string;
  onPick: (customer: SavedCustomer) => void;
}

/** Search the saved customers by name or document and pick one. A failed search just shows no result. */
export function CustomerPicker({ id, onPick }: Props) {
  const t = useTranslations("CustomerPicker");
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState<{ query: string; items: SavedCustomer[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      customersApi.list({ search: query.trim() || undefined, limit: MAX_RESULTS }, controller.signal)
        .then((page) => { if (!controller.signal.aborted) { setAnswer({ query, items: page.items }); setActive(0); } })
        .catch(() => { if (!controller.signal.aborted) setAnswer({ query, items: [] }); });
    }, query ? SEARCH_PAUSE_MS : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  const items = answer?.items ?? [];
  const waiting = answer?.query !== query;

  const choose = (customer: SavedCustomer) => {
    onPick(customer);
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
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${items[active].taxId}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="field pl-9"
          placeholder={t("placeholder")}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setQuery(""); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label={t("label")} className="absolute left-0 right-0 z-30 mt-1.5 max-h-72 overflow-y-auto overscroll-contain rounded-[11px] border border-border-strong bg-surface p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]">
          {waiting && items.length === 0 && <li role="presentation" className="px-3 py-4 text-center text-[13px] text-text-4">{t("searching")}</li>}
          {!waiting && items.length === 0 && <li role="presentation" className="px-3 py-4 text-center text-[13px] text-text-4">{t("empty")}</li>}
          {items.map((customer, index) => (
            <li
              key={customer.taxId}
              id={`${listId}-${customer.taxId}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => { event.preventDefault(); choose(customer); }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline gap-3 rounded-lg px-2.5 py-2 text-[13px] ${index === active ? "bg-active" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate text-text-2">{customer.name}</span>
              <span className="flex-none font-mono tabular-nums text-[12px] text-text-4">{maskTaxId(customer.taxId)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
