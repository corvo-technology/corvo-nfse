"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { MunicipalityAgreement } from "@/lib/types";
import { findMunicipality, loadMunicipalities, type MunicipalityRow } from "@/lib/nfse-municipalities";

type Lookup = { code: string; row: MunicipalityRow | undefined };

/**
 * When the API already asked the Sefin (`agreement`), that answer wins; otherwise the static list below is the fallback.
 *
 * Warns when the company's municipality can make the Receita refuse its invoices, using the official
 * list that already ships with the docs. It stays silent in every other case:
 * - a code that is not on the list is most likely a typo;
 * - an agreement that is not active blocks ME/EPP of the Simples Nacional (rules E0037/E0038 exempt the MEI).
 * Municipalities on the national issuer or sharing with the national environment need no warning:
 * MEI and Simples Nacional issue through the national issuer by federal rule.
 */
export function MunicipalityAgreementNotice({ municipalityCode, taxRegime, agreement, className }: { municipalityCode?: string | null; taxRegime?: string | null; agreement?: MunicipalityAgreement | null; className?: string }) {
  const t = useTranslations("MunicipalityNotice");
  const locale = useLocale();
  const code = municipalityCode ?? "";
  const [lookup, setLookup] = useState<Lookup | null>(null);

  useEffect(() => {
    if (!/^\d{7}$/.test(code)) return;
    let active = true;
    loadMunicipalities()
      .then((data) => { if (active) setLookup({ code, row: findMunicipality(data.rows, code) }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [code]);

  const checked = agreement?.status;
  if (checked === "active") return null;
  // The Sefin says the municipality has not activated the agreement (MEI is exempt, as in the static list).
  if (checked === "inactive") return taxRegime === "MEI" ? null : <p role="status" className={`banner banner-warn ${className ?? ""}`}><span>{t("inactiveChecked", { code })}</span></p>;
  if (checked === "not_found") return <p role="status" className={`banner banner-warn ${className ?? ""}`}><span>{t("notFoundChecked", { code })}</span></p>;
  // not_checked or unknown: fall back to the static list.
  // An answer only counts for the code that is in the field now.
  if (!lookup || lookup.code !== code) return null;
  const docs = <Link href={`/${locale === "en" ? "en" : "pt"}/docs/municipalities`} className="underline">{t("link")}</Link>;
  if (!lookup.row) return <p role="status" className={`banner banner-warn ${className ?? ""}`}><span>{t("unknown", { code })} {docs}</span></p>;
  const [, name, uf, status] = lookup.row;
  if (status !== 0 || taxRegime === "MEI") return null;
  return <p role="status" className={`banner banner-warn ${className ?? ""}`}><span>{t("inactive", { name, uf })} {docs}</span></p>;
}
