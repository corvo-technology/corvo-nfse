"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

export interface CatalogCard {
  id: string;
  name: string;
  initial: string;
  pays: string;
  emit: string;
  cancel: string;
  extra: string;
  note: string;
  connect: string;
}

export interface CatalogGroup {
  id: string;
  title: string;
  hint: string;
  cards: CatalogCard[];
}

export interface CatalogFilter {
  id: string;
  label: string;
}

/**
 * The filter chips and the cards. All text arrives already translated from the server page, so this
 * component reads no messages. "all" shows every group; any other id shows the group of that id.
 */
export function IntegrationsCatalog({ filters, groups, groupLabel, connectHref }: { filters: CatalogFilter[]; groups: CatalogGroup[]; groupLabel: string; connectHref: string }) {
  const [active, setActive] = useState("all");
  const shown = groups.filter((group) => active === "all" || group.id === active);

  return (
    <div className="flex flex-col gap-8">
      <div role="group" aria-label={groupLabel} className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const on = filter.id === active;
          return (
            <button
              key={filter.id}
              type="button"
              aria-pressed={on}
              onClick={() => setActive(filter.id)}
              className={
                on
                  ? "min-h-11 rounded-full border border-ink bg-ink px-5 text-[15px] font-medium text-paper"
                  : "min-h-11 rounded-full border border-ink/30 px-5 text-[15px] font-medium text-ink transition-colors hover:border-ink/60"
              }
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {shown.map((group) => (
        <div key={group.id} data-group={group.id} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{group.title}</h3>
            <p className="text-[14.5px] text-ink-2">{group.hint}</p>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {group.cards.map((card) => (
              <article key={card.id} className="flex flex-col gap-4 rounded-[18px] border border-ink/15 bg-white/40 p-5">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-ink text-[15px] font-semibold text-paper">{card.initial}</span>
                  <div className="min-w-0">
                    <h4 className="text-[17px] font-semibold leading-tight text-ink">{card.name}</h4>
                    <p className="text-[13px] text-ink-2">{card.pays}</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2 text-[14px] leading-snug text-ink">
                  {[card.emit, card.cancel, card.extra].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check aria-hidden size={14} strokeWidth={2.4} className="mt-[3px] shrink-0 text-[#0f6b4f]" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-auto w-fit rounded-full border border-ink/25 px-2.5 py-1 font-mono text-[11.5px] text-ink-2">{card.note}</p>
                <Link
                  href={connectHref}
                  className="inline-flex items-center justify-center rounded-[6px] bg-ink px-4 py-2.5 text-[14px] font-medium text-paper transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:scale-[1.02] hover:opacity-90 active:scale-[0.98]"
                >
                  {card.connect}
                </Link>
              </article>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
