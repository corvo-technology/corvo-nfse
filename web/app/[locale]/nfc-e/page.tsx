import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CardSection, CtaLink, MarketingShell, PageHero, PaperBand, StatusNote } from "@/components/marketing/blocks";
import { SITE_NAME, pageMetadata, pageUrl, seoLocale } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

const PATH = "/nfc-e";
const FEATURES = ["print", "qr", "offline", "payment", "delivery", "cancel"] as const;
const ROWS = ["for", "where", "recipient", "doc", "correction"] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = seoLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "NfcePage" });
  return pageMetadata({ locale, path: PATH, title: t("meta.title"), description: t("meta.description") });
}

export default async function NfcePage({ params }: Props) {
  const locale = seoLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "NfcePage" });

  return (
    <MarketingShell jsonLd={breadcrumbList([{ name: SITE_NAME, url: pageUrl(locale) }, { name: t("crumb"), url: pageUrl(locale, PATH) }])}>
      <PageHero
        eyebrow={t("hero.eyebrow")}
        title={t("hero.title")}
        lead={t("hero.lead")}
        actions={
          <>
            <CtaLink href="/login?mode=signup" variant="primary">{t("hero.cta")}</CtaLink>
            <CtaLink href={`/${locale}/docs/nfce`} variant="secondary">{t("hero.docs")}</CtaLink>
          </>
        }
        note={
          <div className="flex flex-col gap-4">
            <StatusNote note={t("hero.note")} detail={t("hero.release")} />
            <p className="max-w-[520px] text-[13.5px] leading-snug text-text-3">{t("hero.scope")}</p>
          </div>
        }
        aside={
          <div className="flex justify-center">
            <figure aria-label={t("receipt.label")} className="flex w-[300px] max-w-full flex-col gap-2.5 rounded-[6px] bg-white px-5 py-[22px] font-mono text-[11.5px] leading-[1.55] text-ink shadow-[0_24px_48px_-20px_rgba(0,0,0,0.7)]">
              <p className="text-center text-[12.5px] font-bold">{t("receipt.store")}</p>
              <p className="text-center text-ink-2">{t("receipt.doc")}</p>
              <p className="flex justify-between border-t border-dashed border-ink/25 pt-2"><span>{t("receipt.item")}</span><span>15,00</span></p>
              <p className="flex justify-between text-[13px] font-bold"><span>{t("receipt.total")}</span><span>15,00</span></p>
              <p className="flex justify-between"><span>{t("receipt.cash")}</span><span>20,00</span></p>
              <p className="flex justify-between"><span>{t("receipt.change")}</span><span>5,00</span></p>
              <p className="border-t border-dashed border-ink/25 pt-2 text-center text-ink-2">{t("receipt.check")}</p>
              <span aria-hidden className="h-[120px] w-[120px] self-center border-[6px] border-white bg-[repeating-conic-gradient(#0d0d0c_0_25%,#ffffff_0_50%)] bg-[length:15px_15px] outline outline-1 outline-ink" />
              <p className="text-center text-ink-2">{t("receipt.protocol")}</p>
            </figure>
          </div>
        }
      />

      <CardSection id="faz" title={t("features.title")} items={FEATURES.map((key) => ({ key, title: t(`features.items.${key}.title`), body: t(`features.items.${key}.body`) }))} />

      <PaperBand labelledBy="quando">
        <div className="flex flex-col gap-8">
          <h2 id="quando" className="text-[clamp(30px,4vw,48px)] font-semibold leading-[1.04] tracking-[-0.035em] text-ink">{t("compare.title")}</h2>
          <div className="overflow-x-auto rounded-[18px] border border-ink/15 bg-white/40">
            <table className="w-full min-w-[620px] border-collapse text-left text-[15px]">
              <caption className="sr-only">{t("compare.caption")}</caption>
              <thead>
                <tr className="border-b border-ink/15 text-ink-2">
                  <th scope="col" className="px-5 py-4 font-medium">{t("compare.head.what")}</th>
                  <th scope="col" className="px-5 py-4 font-semibold text-ink">{t("compare.head.nfce")}</th>
                  <th scope="col" className="px-5 py-4 font-semibold text-ink">{t("compare.head.nfe")}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row} className="border-b border-ink/10 last:border-0">
                    <th scope="row" className="px-5 py-4 font-medium text-ink-2">{t(`compare.rows.${row}.label`)}</th>
                    <td className="px-5 py-4 text-ink">{t(`compare.rows.${row}.nfce`)}</td>
                    <td className="px-5 py-4 text-ink">{t(`compare.rows.${row}.nfe`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <CtaLink href="/login?mode=signup" variant="primary" tone="paper">{t("compare.start")}</CtaLink>
              <CtaLink href={`/${locale}/nf-e`} variant="secondary" tone="paper">{t("compare.other")}</CtaLink>
            </div>
            <StatusNote tone="paper" note={t("hero.note")} detail={t("hero.release")} />
          </div>
        </div>
      </PaperBand>
    </MarketingShell>
  );
}
