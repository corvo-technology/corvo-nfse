"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { findMunicipality, loadMunicipalities, type MunicipalityRow } from "@/lib/nfse-municipalities";

type Lookup = { code: string; row: MunicipalityRow | undefined };

/**
 * Warns when the company's municipality can make the Receita refuse its invoices, using the official
 * list that already ships with the docs. It stays silent in every other case:
 * - a code that is not on the list is most likely a typo;
 * - an agreement that is not active blocks ME/EPP of the Simples Nacional (rules E0037/E0038 exempt the MEI).
 * Municipalities on the national issuer or sharing with the national environment need no warning:
 * MEI and Simples Nacional issue through the national issuer by federal rule.
 */
export function MunicipalityAgreementNotice({ municipalityCode, taxRegime, className }: { municipalityCode?: string | null; taxRegime?: string | null; className?: string }) {
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

  // An answer only counts for the code that is in the field now.
  if (!lookup || lookup.code !== code) return null;
  const docs = <Link href={`/${locale === "en" ? "en" : "pt"}/docs/municipalities`} className="underline">{t("link")}</Link>;
  if (!lookup.row) return <p role="status" className={`banner banner-warn ${className ?? ""}`}><span>{t("unknown", { code })} {docs}</span></p>;
  const [, name, uf, status] = lookup.row;
  if (status !== 0 || taxRegime === "MEI") return null;
  return <p role="status" className={`banner banner-warn ${className ?? ""}`}><span>{t("inactive", { name, uf })} {docs}</span></p>;
}
