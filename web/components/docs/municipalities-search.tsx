"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { MunicipalitiesBlock } from "@/lib/docs/types";
import { filterMunicipalities, loadMunicipalities, type MunicipalityData, type MunicipalityStatus, type StatusFilter } from "@/lib/nfse-municipalities";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";

const PAGE_SIZE = 50;
const FILTERS: StatusFilter[] = ["all", "emissor", "ambiente", "inactive"];
const FILTER_STATUS: Record<Exclude<StatusFilter, "all">, MunicipalityStatus> = { emissor: 2, ambiente: 1, inactive: 0 };
const BADGE: Record<MunicipalityStatus, { variant: "accent" | "gray" | "warn"; key: "emissor" | "ambiente" | "inactive" }> = {
  2: { variant: "accent", key: "emissor" },
  1: { variant: "gray", key: "ambiente" },
  0: { variant: "warn", key: "inactive" },
};

export function MunicipalitiesSearch({ locale, labels }: Pick<MunicipalitiesBlock, "locale" | "labels">) {
  const [data, setData] = useState<MunicipalityData | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [uf, setUf] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    let alive = true;
    loadMunicipalities().then((loaded) => { if (alive) setData(loaded); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const number = useMemo(() => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US"), [locale]);
  const date = useMemo(() => new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", { timeZone: "UTC" }), [locale]);
  const states = useMemo(() => (data ? [...new Set(data.rows.map((row) => row[2]))].sort() : []), [data]);

  // The search and the state narrow the list; the situation chips show how that list splits.
  const narrowed = useMemo(() => (data ? filterMunicipalities(data.rows, { query, uf, status: "all" }) : []), [data, query, uf]);
  const perStatus = useMemo(() => {
    const tally: Record<StatusFilter, number> = { all: narrowed.length, emissor: 0, ambiente: 0, inactive: 0 };
    for (const row of narrowed) tally[BADGE[row[3]].key]++;
    return tally;
  }, [narrowed]);
  const shown = status === "all" ? narrowed : narrowed.filter((row) => row[3] === FILTER_STATUS[status]);

  const change = <T,>(set: (value: T) => void) => (value: T) => { set(value); setVisible(PAGE_SIZE); };

  if (failed) return <p role="alert" className="text-sm text-danger">{labels.loadError}</p>;
  if (!data) return <p className="text-sm text-text-3">{labels.loading}</p>;

  const remaining = shown.length - visible;
  return (
    <div className="not-prose rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <label className="flex flex-col gap-1.5 text-[13px] text-text-3">
          {labels.searchLabel}
          <input type="search" value={query} placeholder={labels.searchPlaceholder} autoComplete="off" onChange={(e) => change(setQuery)(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-text-3">
          {labels.stateLabel}
          <Select value={uf} onChange={(e) => change(setUf)(e.target.value)}>
            <option value="">{labels.allStates}</option>
            {states.map((state) => <option key={state} value={state}>{state}</option>)}
          </Select>
        </label>
      </div>

      <div role="group" aria-label={labels.columns.status} className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            aria-pressed={status === filter}
            onClick={() => change(setStatus)(filter)}
            className={cn("rounded-full border px-3 py-1 text-[12.5px] transition-colors", status === filter ? "border-accent-border bg-accent-surface text-accent" : "border-border text-text-3 hover:text-text")}
          >
            {labels.status[filter]} <span className="text-text-4">{number.format(perStatus[filter])}</span>
          </button>
        ))}
      </div>

      <p role="status" aria-live="polite" className="mt-4 text-[13px] text-text-3">
        {shown.length === 1 ? labels.resultsOne : labels.results.replace("{count}", number.format(shown.length))}
      </p>

      {shown.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-3">{labels.empty}</p>
      ) : (
        <>
          <div aria-hidden className="mt-2 hidden grid-cols-[1fr_7rem_12rem_8rem] gap-3 border-b border-border px-3 pb-2 text-[12px] text-text-4 sm:grid">
            <span>{labels.columns.name}</span><span>{labels.columns.ibge}</span><span>{labels.columns.status}</span><span>{labels.columns.since}</span>
          </div>
          <ul className="divide-y divide-border">
            {shown.slice(0, visible).map(([ibge, name, state, rowStatus, since]) => (
              <li key={ibge} className="grid gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:grid-cols-[1fr_7rem_12rem_8rem] sm:items-center">
                <span className="text-text">{name} <span className="text-text-4">· {state}</span></span>
                <span className="font-mono text-[12.5px] text-text-3">{ibge}</span>
                <span><Badge variant={BADGE[rowStatus].variant} dot={false}>{labels.status[BADGE[rowStatus].key]}</Badge></span>
                <span className="text-[12.5px] text-text-3">{since ? date.format(new Date(`${since}T00:00:00Z`)) : ""}</span>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <button type="button" onClick={() => setVisible(visible + PAGE_SIZE)} className="mt-3 rounded-lg border border-border px-4 py-2 text-[13px] text-text-2 transition-colors hover:border-border-strong hover:text-text">
              {labels.showMore.replace("{count}", number.format(Math.min(PAGE_SIZE, remaining)))}
            </button>
          )}
        </>
      )}

      <p className="mt-4 text-[12.5px] text-text-4">
        {labels.source}{" "}
        <a href={data.source.url} target="_blank" rel="noopener noreferrer" className="text-text-3 underline-offset-4 hover:text-text hover:underline">{labels.sourceLink}</a>
      </p>
    </div>
  );
}
