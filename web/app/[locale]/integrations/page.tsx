import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CtaLink, MarketingShell, PageHero, SECONDARY_LINK } from "@/components/marketing/blocks";
import { IntegrationsCatalog, type CatalogGroup } from "@/components/marketing/integrations-catalog";
import { INTEGRATION_GROUPS, INTEGRATION_PLATFORMS } from "@/lib/integrations-catalog";
import { SITE_NAME, pageMetadata, pageUrl, seoLocale } from "@/lib/seo";
import { REPO_URL } from "@/lib/repo";
import { CONTACT_EMAIL, breadcrumbList } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

const INTEGRATIONS_PATH = "/integrations";

const CONTRIBUTE_STEPS = ["copy", "test", "pr"] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = seoLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "IntegrationsPage" });
  return pageMetadata({ locale, path: INTEGRATIONS_PATH, title: t("meta.title"), description: t("meta.description") });
}

const HOW_STEPS = ["choose", "paste", "done"] as const;
const BEHAVIORS = ["refund", "dispute", "pending", "share", "once"] as const;

export default async function IntegrationsPage({ params }: Props) {
  const locale = seoLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "IntegrationsPage" });

  const total = INTEGRATION_PLATFORMS.length;
  const groups: CatalogGroup[] = INTEGRATION_GROUPS.map((group) => {
    const platforms = INTEGRATION_PLATFORMS.filter((platform) => platform.group === group);
    return {
      id: group,
      title: t(`groups.${group}.title`),
      hint: t(`groups.${group}.hint`),
      cards: platforms.map((platform) => ({
        id: platform.id,
        name: platform.name,
        initial: platform.initial,
        pays: t(`platforms.${platform.id}.pays`),
        emit: t(`platforms.${platform.id}.emit`),
        cancel: t(`platforms.${platform.id}.cancel`),
        extra: t(`platforms.${platform.id}.extra`),
        note: t(`platforms.${platform.id}.note`),
        connect: t("list.connect", { name: platform.name }),
      })),
    };
  });
  const filters = [
    { id: "all", label: t("filters.all", { count: total }) },
    ...groups.map((group) => ({ id: group.id, label: t(`filters.${group.id}`, { count: group.cards.length }) })),
  ];

  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("missing.subject"))}`;

  return (
    <MarketingShell jsonLd={breadcrumbList([{ name: SITE_NAME, url: pageUrl(locale) }, { name: t("crumb"), url: pageUrl(locale, INTEGRATIONS_PATH) }])}>
      <PageHero
        eyebrow={t("hero.eyebrow", { count: total })}
        title={t("hero.title")}
        lead={t("hero.lead")}
        actions={
          <>
            <CtaLink href="/login?mode=signup" variant="primary">{t("hero.cta")}</CtaLink>
            <a
              href="#como-funciona"
              className={SECONDARY_LINK}
            >
              {t("hero.how")}
            </a>
          </>
        }
      />

      <section aria-labelledby="lista" className="bg-paper text-ink px-6 pt-[calc(6vw+48px)] pb-[calc(6vw+48px)] sm:px-10 [clip-path:polygon(0_0,100%_6vw,100%_100%,0_calc(100%-6vw))]">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-8">
          <h2 id="lista" className="text-[clamp(30px,4vw,48px)] font-semibold leading-[1.04] tracking-[-0.035em] text-ink">{t("list.title")}</h2>
          <IntegrationsCatalog filters={filters} groups={groups} groupLabel={t("list.groupLabel")} connectHref="/login?mode=signup" />
          <p className="text-[14px] text-ink-2">{t("list.cancelNote")}</p>
        </div>
      </section>

      <section id="como-funciona" aria-labelledby="como" className="mx-auto grid max-w-[1120px] scroll-mt-20 gap-12 px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 id="como" className="text-balance text-[clamp(30px,4vw,48px)] font-semibold leading-[1.04] tracking-[-0.035em] text-text">{t("how.title")}</h2>
          <ol className="mt-8 flex flex-col gap-5">
            {HOW_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-3.5">
                <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border-strong text-[12px] text-text-2">{index + 1}</span>
                <div>
                  <p className="text-[15.5px] font-medium text-text">{t(`how.steps.${step}.title`)}</p>
                  <p className="mt-0.5 max-w-[420px] text-[14.5px] leading-snug text-text-2">{t(`how.steps.${step}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-text">{t("behaviors.title")}</h2>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            {BEHAVIORS.map((item) => (
              <div key={item} className="flex flex-col gap-2 rounded-[18px] border border-white/[0.08] bg-[#101010] p-5">
                <dt className="text-[15.5px] font-semibold text-text">{t(`behaviors.items.${item}.title`)}</dt>
                <dd className="text-[14px] leading-relaxed text-text-2">{t(`behaviors.items.${item}.body`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="contribua" className="border-t border-border-soft px-6 py-16 sm:px-10">
        <div className="mx-auto grid max-w-[1120px] gap-10 md:grid-cols-2 md:items-start">
          <div className="max-w-[520px]">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-4">{t("contribute.eyebrow")}</p>
            <h2 id="contribua" className="mt-3 text-[clamp(26px,3.4vw,36px)] font-semibold tracking-[-0.03em] text-text">{t("contribute.title")}</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-text-2">{t("contribute.body")}</p>
            <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <CtaLink href={`${REPO_URL}/tree/main/api/src/modules/integrations/connectors`} variant="primary">{t("contribute.example")}</CtaLink>
              <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} className={SECONDARY_LINK}>{t("contribute.guide")}</a>
            </div>
          </div>
          <ol className="flex flex-col gap-4">
            {CONTRIBUTE_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-3.5">
                <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border-strong text-[12px] text-text-2">{index + 1}</span>
                <div>
                  <p className="text-[15.5px] font-medium text-text">{t(`contribute.steps.${step}.title`)}</p>
                  <p className="mt-0.5 max-w-[420px] text-[14.5px] leading-snug text-text-2">{t(`contribute.steps.${step}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="falta" className="border-t border-border-soft px-6 py-16 sm:px-10">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-6">
          <div className="max-w-[620px]">
            <h2 id="falta" className="text-[clamp(26px,3.4vw,36px)] font-semibold tracking-[-0.03em] text-text">{t("missing.title")}</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-text-2">{t("missing.body")}</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <CtaLink href={`/${locale}/api-docs`} variant="primary">{t("missing.api")}</CtaLink>
            <a
              href={mailto}
              className={SECONDARY_LINK}
            >
              {t("missing.request")}
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
