"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { collectAll, companies as companiesApi } from "@/lib/api";
import { getNfe } from "@/lib/nfe";
import { emptyForm, fromDocument, type NfeFormState } from "@/lib/nfe-form";
import type { Company } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";
import { NfeForm } from "@/components/nfe/nfe-form";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { PageHeader } from "@/components/ui/page-header";

export default function NewNfePage() {
  return <Suspense><NewNfe /></Suspense>;
}

/** A new NF-e, or (with `?resubmit=<id>`) a rejected one filled in to be fixed and sent again. */
function NewNfe() {
  const t = useTranslations("Nfe.new");
  const apiError = useApiErrorText();
  const resubmitId = useSearchParams().get("resubmit") ?? undefined;
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [initial, setInitial] = useState<NfeFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      collectAll((cursor) => companiesApi.list({ cursor, limit: 100 }, abort.signal)),
      resubmitId ? getNfe(resubmitId, abort.signal) : Promise.resolve(null),
    ])
      .then(([rows, doc]) => {
        if (abort.signal.aborted) return;
        setCompanies(rows);
        setInitial(doc ? fromDocument(doc) : emptyForm(rows.length === 1 ? rows[0].id : ""));
      })
      .catch((cause) => { if (!abort.signal.aborted) setError(apiError(cause, t("failed"))); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the texts change with the language, not with the data
  }, [resubmitId]);

  return (
    <div className="flex max-w-[900px] flex-col gap-6">
      <PageHeader title={resubmitId ? t("resubmitTitle") : t("title")} subtitle={resubmitId ? t("resubmitSubtitle") : t("subtitle")} />
      {error ? <p role="alert" className="banner banner-danger">{error}</p> : !companies || !initial ? <DetailSkeleton label={t("loading")} /> : <NfeForm companies={companies} initial={initial} resubmitId={resubmitId} />}
    </div>
  );
}
