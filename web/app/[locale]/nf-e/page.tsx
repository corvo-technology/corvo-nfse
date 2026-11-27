import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CardSection, CtaLink, MarketingShell, PageHero, StatusNote } from "@/components/marketing/blocks";
import { SITE_NAME, pageMetadata, pageUrl, seoLocale } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

const PATH = "/nf-e";

/** The body of POST /v1/invoices for an NF-e, as in the NF-e docs (the recipient address and the item unit are required). */
const REQUEST = `{
  "type": "nfe",
  "companyId": "5b8b6a0e-…-0d7a6d5c2e11",
  "recipient": {
    "taxId": "123.456.789-09",
    "name": "Maria da Silva",
    "indIeDest": 9,
    "address": {
      "street": "Rua das Flores", "number": "10",
      "district": "Centro", "zip": "01001-000",
      "cityCode": "3550308", "city": "São Paulo", "state": "SP"
    }
  },
  "items": [{
    "code": "SKU1", "description": "Camiseta de algodão",
    "ncm": "61091000", "cfop": "5102", "unit": "UN",
    "quantity": 2, "unitPrice": 10
  }],
  "payments": [{ "tPag": "17", "amount": 20 }]
}`;

const FEATURES = ["danfe", "validate", "autofill", "correction", "svc", "webhooks"] as const;
const STEPS = [
  ["validate", "POST /invoices/validate"],
  ["issue", "POST /invoices"],
  ["download", "POST /invoices/:id/download-url"],
  ["correct", "POST /invoices/:id/corrections"],
  ["cancel", "POST /invoices/:id/cancel"],
] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = seoLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "NfePage" });
  return pageMetadata({ locale, path: PATH, title: t("meta.title"), description: t("meta.description") });
}

export default async function NfePage({ params }: Props) {
  const locale = seoLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "NfePage" });

  return (
    <MarketingShell jsonLd={breadcrumbList([{ name: SITE_NAME, url: pageUrl(locale) }, { name: t("crumb"), url: pageUrl(locale, PATH) }])}>
      <PageHero
        eyebrow={t("hero.eyebrow")}
        title={t("hero.title")}
        lead={t("hero.lead")}
        actions={
          <>
            <CtaLink href="/login?mode=signup" variant="primary">{t("hero.cta")}</CtaLink>
            <CtaLink href={`/${locale}/docs/nfe`} variant="secondary">{t("hero.docs")}</CtaLink>
          </>
        }
        note={
          <div className="flex flex-col gap-4">
            <StatusNote note={t("hero.note")} detail={t("hero.release")} />
            <p className="max-w-[520px] text-[13.5px] leading-snug text-text-3">{t("hero.scope")}</p>
          </div>
        }
        aside={
          <figure aria-label={t("code.label")} className="min-w-0 rounded-[18px] border border-white/[0.08] bg-[#101010] p-5 font-mono text-[12.5px] leading-[1.7] text-text shadow-[0_24px_50px_-26px_rgba(0,0,0,0.95)] sm:p-6">
            <p className="text-text-3">POST /v1/invoices</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre text-text">{REQUEST}</pre>
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/[0.06] pt-4">
              <span className="text-accent">202</span>
              <span className="text-text-2">{t("code.result")}</span>
            </div>
          </figure>
        }
      />

      <CardSection id="faz" title={t("features.title")} items={FEATURES.map((key) => ({ key, title: t(`features.items.${key}.title`), body: t(`features.items.${key}.body`) }))} />

      <section aria-labelledby="ciclo" className="border-y border-border-soft px-6 py-16 sm:px-10 sm:py-20">
        <div className="mx-auto max-w-[1120px]">
          <h2 id="ciclo" className="max-w-[760px] text-balance text-[clamp(28px,3.8vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em] text-text">{t("lifecycle.title")}</h2>
          <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(([key, code]) => (
              <li key={key} className="flex flex-col gap-2 rounded-[16px] border border-white/[0.08] bg-[#101010] p-5">
                <code className="break-words font-mono text-[11.5px] text-accent">{code}</code>
                <p className="text-[16px] font-semibold text-text">{t(`lifecycle.steps.${key}.title`)}</p>
                <p className="text-[14px] leading-snug text-text-2">{t(`lifecycle.steps.${key}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="preco" className="mx-auto grid max-w-[1120px] items-center gap-10 px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 id="preco" className="text-balance text-[clamp(28px,3.8vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em] text-text">{t("credit.title")}</h2>
          <p className="max-w-[520px] text-[17px] leading-relaxed text-text-2">{t("credit.body")}</p>
        </div>
        <div className="flex flex-col items-start gap-5">
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <CtaLink href={`/${locale}#pricing`} variant="primary">{t("credit.plans")}</CtaLink>
            <CtaLink href={`/${locale}/nfc-e`} variant="secondary">{t("credit.other")}</CtaLink>
          </div>
          <StatusNote note={t("hero.note")} detail={t("hero.release")} />
        </div>
      </section>
    </MarketingShell>
  );
}
