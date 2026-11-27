import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FAQ_ITEMS } from "@/lib/landing-faq";
import { nfeProductionEnabled } from "@/lib/nfe-availability";

export function FaqSection() {
  const t = useTranslations("LandingFaq");
  const locale = useLocale();
  const live = nfeProductionEnabled();
  // Each answer ends with a link to the part of the docs (or the page) that goes deeper.
  const hrefOf = (item: (typeof FAQ_ITEMS)[number]) =>
    "external" in item ? item.external : `/${locale}${item.path}${"anchor" in item ? item.anchor : ""}`;

  return (
    <section id="faq" className="mx-auto max-w-[1120px] scroll-mt-20 px-6 pb-20 sm:px-10 sm:pb-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)] lg:gap-16">
        <div>
          <h2 className="max-w-[360px] text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.04em] text-text sm:text-[40px]">{t("title")}</h2>
          <p className="mt-4 max-w-[340px] text-[15.5px] leading-relaxed text-text-3">{t("description")}</p>
          <Link href={`/${locale}/docs`} className="mt-6 inline-flex items-center gap-1 text-[13.5px] text-text-2 underline-offset-4 transition-colors hover:text-text hover:underline">
            {t("docs")} <ArrowUpRight size={13} aria-hidden />
          </Link>
        </div>

        <div className="divide-y divide-border-soft border-y border-border-soft">
          {FAQ_ITEMS.map((item, index) => (
            <details key={item.id} open={index === 0} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-md py-4 text-left text-[16.5px] font-medium text-text outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
                {t(`items.${item.id}.q`)}
                <Plus size={18} aria-hidden className="shrink-0 text-text-3 transition-transform duration-200 group-open:rotate-45" />
              </summary>
              <div className="pb-5 pr-10">
                <p className="max-w-[62ch] text-[15px] leading-relaxed text-text-3">{item.id === "types" && live ? t("items.types.aLive") : t(`items.${item.id}.a`)}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                  <Link
                    href={hrefOf(item)}
                    {...("external" in item ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="inline-flex items-center gap-1 text-[13.5px] text-accent underline-offset-4 hover:underline"
                  >
                    {t(`items.${item.id}.link`)} <ArrowUpRight size={13} aria-hidden />
                  </Link>
                  {"extra" in item && (
                    <Link href={`/${locale}${item.extra.path}`} className="inline-flex items-center gap-1 text-[13.5px] text-accent underline-offset-4 hover:underline">
                      {t(`items.${item.id}.link2` as "items.sdks.link2")} <ArrowUpRight size={13} aria-hidden />
                    </Link>
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
