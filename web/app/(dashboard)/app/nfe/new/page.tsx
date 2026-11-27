"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { collectAll, companies as companiesApi } from "@/lib/api";
import { getNfe, type NfeDocument, type NfeKind } from "@/lib/nfe";
import { emptyForm, fromDocument, type NfeFormState } from "@/lib/nfe-form";
import { emptyNfceForm, fromNfceDocument } from "@/lib/nfce-form";
import type { Company } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";
import { NfceForm } from "@/components/nfe/nfce-form";
import { NfeForm } from "@/components/nfe/nfe-form";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { PageHeader } from "@/components/ui/page-header";

export default function NewNfePage() {
  return <Suspense><NewNfe /></Suspense>;
}

/**
 * A new NF-e or consumer sale (NFC-e), or (with `?resubmit=<id>`) a rejected note filled in to be
 * fixed and sent again. The chooser lets the person pick one; `?type=nfce` opens on the sale.
 */
function NewNfe() {
  const t = useTranslations("Nfe.new");
  const tc = useTranslations("Nfe.consumer");
  const apiError = useApiErrorText();
  const params = useSearchParams();
  const resubmitId = params.get("resubmit") ?? undefined;
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [doc, setDoc] = useState<NfeDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState<NfeKind>(params.get("type") === "nfce" ? "nfce" : "nfe");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      collectAll((cursor) => companiesApi.list({ cursor, limit: 100 }, abort.signal)),
      resubmitId ? getNfe(resubmitId, abort.signal) : Promise.resolve(null),
    ])
      .then(([rows, found]) => {
        if (abort.signal.aborted) return;
        setCompanies(rows);
        setDoc(found);
        setLoaded(true);
      })
      .catch((cause) => { if (!abort.signal.aborted) setError(apiError(cause, t("failed"))); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the texts change with the language, not with the data
  }, [resubmitId]);

  // The kind is a fact of the note being fixed; otherwise the person chooses.
  const kind: NfeKind = doc ? doc.type : chosen;
  const chooser = !resubmitId;
  const only = companies && companies.length === 1 ? companies[0].id : "";
  const nfeInitial: NfeFormState | null = loaded ? (doc && doc.type === "nfe" ? fromDocument(doc) : emptyForm(only)) : null;
  const title = kind === "nfce" ? (resubmitId ? tc("resubmitTitle") : tc("title")) : resubmitId ? t("resubmitTitle") : t("title");
  const subtitle = kind === "nfce" ? (resubmitId ? tc("resubmitSubtitle") : tc("subtitle")) : resubmitId ? t("resubmitSubtitle") : t("subtitle");

  return (
    <div className="flex max-w-[900px] flex-col gap-6">
      <PageHeader title={title} subtitle={subtitle} />
      {chooser && (
        <div role="radiogroup" aria-label={tc("typeTitle")} className="flex flex-wrap gap-3">
          {(["nfe", "nfce"] as const).map((value) => (
            <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-[12px] border px-4 py-2.5 text-sm ${chosen === value ? "border-accent text-text" : "border-border text-text-3"}`}>
              <input type="radio" name="kind" className="sr-only" checked={chosen === value} onChange={() => setChosen(value)} aria-label={value === "nfce" ? tc("typeNfce") : tc("typeNfe")} />
              <span aria-hidden>{value === "nfce" ? tc("typeNfce") : tc("typeNfe")}</span>
            </label>
          ))}
        </div>
      )}
      {error ? <p role="alert" className="banner banner-danger">{error}</p>
        : !companies || !loaded ? <DetailSkeleton label={t("loading")} />
        : kind === "nfce"
          ? <NfceForm key="nfce" companies={companies} initial={doc && doc.type === "nfce" ? fromNfceDocument(doc) : emptyNfceForm(only)} resubmitId={resubmitId} />
          : <NfeForm key="nfe" companies={companies} initial={nfeInitial!} resubmitId={resubmitId} />}
    </div>
  );
}
