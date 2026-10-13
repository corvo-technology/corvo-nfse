"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { SERVICE_CODES, type ServiceCode } from "@/lib/service-codes";

const POPULAR = ["010101", "010201", "010601", "010701", "010801", "170101", "171901", "171401", "080101"];
const MAX_RESULTS = 40;

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const INDEX = SERVICE_CODES.map((item) => ({ item, haystack: normalize(`${item.code} ${item.lc116} ${item.description}`) }));
const BY_CODE = new Map(SERVICE_CODES.map((item) => [item.code, item]));

interface Props {
  id: string;
  value: string;
  onChange: (code: string) => void;
  required?: boolean;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/** Searchable select for the national service tax code (cTribNac). Any 6-digit code can also be typed. */
export function ServiceCodeCombobox({ id, value, onChange, required, placeholder, ...aria }: Props) {
  const t = useTranslations("ServiceCode");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = BY_CODE.get(value);
  const results = useMemo<ServiceCode[]>(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return POPULAR.map((code) => BY_CODE.get(code)).filter((x): x is ServiceCode => !!x);
    return INDEX.filter(({ haystack }) => tokens.every((token) => haystack.includes(token))).slice(0, MAX_RESULTS).map(({ item }) => item);
  }, [query]);

  const customCode = /^\d{6}$/.test(query.trim()) && !BY_CODE.has(query.trim()) ? query.trim() : null;
  const options = customCode ? [...results, { code: customCode, description: t("useCustom"), lc116: "" }] : results;

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
  };
  const openList = () => { if (!open) { setOpen(true); setActive(0); } };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); openList(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter" && open && options[active]) { event.preventDefault(); choose(options[active].code); }
    else if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); setQuery(""); }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-4" />
        <input
          {...aria}
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].code}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="field pl-9 pr-9"
          placeholder={placeholder ?? t("placeholder")}
          required={required && !value}
          value={open ? query : value ? `${value}${selected ? ` · ${selected.description}` : ""}` : ""}
          onFocus={() => { setOpen(true); setActive(0); }}
          onBlur={() => { setOpen(false); if (customCode) onChange(customCode); setQuery(""); }}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {value ? <button type="button" aria-label={t("clear")} aria-controls={id} onClick={() => { inputRef.current?.focus(); choose(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-4 hover:text-text"><X size={14} aria-hidden /></button> : <ChevronsUpDown size={14} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-4" />}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("label")}
          className="absolute left-0 right-0 z-30 mt-1.5 max-h-72 overflow-y-auto overscroll-contain rounded-[11px] border border-border-strong bg-surface p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]"
        >
          {query.trim() === "" && <li role="presentation" className="eyebrow px-2.5 pb-1 pt-1.5">{t("popular")}</li>}
          {options.length === 0 && <li role="presentation" className="px-3 py-4 text-center text-[13px] text-text-4">{t("empty")}</li>}
          {options.map((option, index) => (
            <li
              key={option.code}
              id={`${listId}-${option.code}`}
              role="option"
              aria-selected={option.code === value}
              ref={(node) => { if (node && index === active) node.scrollIntoView({ block: "nearest" }); }}
              onMouseDown={(event) => { event.preventDefault(); choose(option.code); }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 text-[13px] ${index === active ? "bg-active" : ""}`}
            >
              <span className="mt-px flex-none font-mono tabular-nums text-text-2">{option.code}</span>
              <span className="min-w-0 flex-1 text-text-3 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{option.description}</span>
              {option.lc116 && <span className="flex-none font-mono text-[11px] text-text-5">{option.lc116}</span>}
              {option.code === value && <Check size={14} aria-hidden className="mt-0.5 flex-none text-accent" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
