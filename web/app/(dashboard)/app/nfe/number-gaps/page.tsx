"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { collectAll, companies as companiesApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createInutilization, JUSTIFICATION_MAX, JUSTIFICATION_MIN, listInutilizations, listNumberGaps, type NfeInutilization, type NfeNumberGap } from "@/lib/nfe";
import type { Company } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";
import { NfeReasonDialog } from "@/components/nfe/nfe-reason-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Skipped NF-e numbers per company and series, and the button to inutilize a range. */
export default function NfeNumberGapsPage() {
  const t = useTranslations("Nfe.gaps");
  const ts = useTranslations("Nfe.gaps.status");
  const apiError = useApiErrorText();
  const { can } = useAuth();
  const [gaps, setGaps] = useState<NfeNumberGap[] | null>(null);
  const [requests, setRequests] = useState<NfeInutilization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<NfeNumberGap | null>(null);
  // One key per opening of the dialog: sending it twice never inutilizes twice.
  const key = useRef("");

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([listNumberGaps(undefined, abort.signal), listInutilizations({ limit: 20 }, abort.signal), collectAll((cursor) => companiesApi.list({ cursor, limit: 100 }, abort.signal))])
      .then(([found, page, rows]) => { if (!abort.signal.aborted) { setGaps(found); setRequests(page.items); setCompanies(rows); setError(null); } })
      .catch((cause) => { if (!abort.signal.aborted) setError(apiError(cause, t("failed"))); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the texts change with the language, not with the data
  }, [revision]);

  const name = (id: string) => { const found = companies.find((company) => company.id === id); return found ? (found.tradeName || found.legalName) : id.slice(0, 8); };
  const range = (gap: { start: number; end: number }) => (gap.start === gap.end ? String(gap.start) : `${gap.start} – ${gap.end}`);
  const canManage = can("nfe.documents.manage");
  const open = (gap: NfeNumberGap) => { key.current = crypto.randomUUID(); setNotice(null); setTarget(gap); };

  return (
    <div className="flex max-w-[900px] flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={<Link href="/app/nfe" className="btn btn-secondary">{t("back")}</Link>} />
      {error && <p role="alert" className="banner banner-danger">{error}</p>}
      {notice && <p role="status" className="banner banner-ok">{notice}</p>}
      <Card className="overflow-hidden">
        {gaps === null && !error ? <p className="p-5 text-sm text-text-3" role="status">{t("loading")}</p> : gaps !== null && gaps.length === 0 ? <EmptyState title={t("none")} description={t("noneHint")} /> : (
          <ul className="flex flex-col divide-y divide-border">
            {(gaps ?? []).map((gap) => (
              <li key={`${gap.companyId}-${gap.series}-${gap.start}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0"><p>{name(gap.companyId)}</p><p className="font-mono text-[13px] text-text-3">{t("seriesNumbers", { series: gap.series, range: range(gap) })}</p></div>
                {canManage && <Button variant="secondary" onClick={() => open(gap)}>{t("inutilize")}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {requests.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-medium">{t("requests")}</h2>
          <ul className="flex flex-col divide-y divide-border">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="font-mono text-[13px]">{name(request.companyId)} · {t("seriesNumbers", { series: request.series, range: range(request) })}</span>
                <span className="text-sm text-text-3">{ts.has(request.status) ? ts(request.status) : request.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {target && (
        <NfeReasonDialog
          open
          onClose={() => setTarget(null)}
          title={t("dialogTitle")}
          description={t("dialogDescription", { series: target.series, range: range(target) })}
          label={t("justification")}
          submitLabel={t("confirm")}
          min={JUSTIFICATION_MIN}
          max={JUSTIFICATION_MAX}
          danger
          onSubmit={async (justification) => {
            await createInutilization({ companyId: target.companyId, series: target.series, start: target.start, end: target.end, justification }, key.current);
            setTarget(null); setNotice(t("requested")); setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
