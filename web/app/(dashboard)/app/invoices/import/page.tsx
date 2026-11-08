"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ImportReading } from "@/components/imports/import-reading";
import { ImportProgress } from "@/components/imports/import-progress";
import { ImportReview } from "@/components/imports/import-review";
import { ImportUpload } from "@/components/imports/import-upload";
import { PendingCreditsBanner, RecentImports } from "@/components/imports/recent-imports";
import { useAuth } from "@/lib/auth";
import { importStage } from "@/lib/imports";
import type { ImportStart } from "@/lib/types";
import { useImport } from "@/lib/use-import";
import { useRecentImports } from "@/lib/use-recent-imports";

const HOME = "/app/invoices/import";

export default function ImportPage() {
  return <Suspense><ImportFlow /></Suspense>;
}

/** One page, four moments: send, (reading), review, issue. The import id lives in the address, so a reload resumes. */
function ImportFlow() {
  const t = useTranslations("Imports");
  const router = useRouter();
  const { can } = useAuth();
  const id = useSearchParams().get("id");
  const { job, error, refresh, reconnecting, updatedAt, changedAt } = useImport(id);
  const recent = useRecentImports(10, !id);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const restart = () => { setDuplicateOf(null); router.replace(HOME); };
  const started = (start: ImportStart) => { setDuplicateOf(start.duplicateOf); router.replace(`${HOME}?id=${encodeURIComponent(start.id)}`); };

  if (!can("nfse.invoices.issue")) return null;
  const stage = id ? importStage(job) : "upload";

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/app/invoices" className="inline-flex w-fit items-center gap-1.5 text-[13.5px] text-text-3 hover:text-text"><ArrowLeft size={14} aria-hidden />{t("back")}</Link>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
      </div>

      {id && error && !job ? (
        <EmptyState tone="danger" title={t("failed.title")} description={t("failed.fallback")} action={<Button variant="secondary" onClick={restart}>{t("failed.again")}</Button>} />
      ) : stage === "upload" ? (
        <>
          <PendingCreditsBanner recent={recent} />
          <ImportUpload onStarted={started} />
          <RecentImports recent={recent} />
        </>
      ) : !job || stage === "reading" ? (
        <ImportReading job={job} live={{ updatedAt, changedAt, reconnecting }} />
      ) : stage === "failed" ? (
        <EmptyState tone="danger" title={t("failed.title")} description={job.errorCode && t.has(`failed.${job.errorCode}`) ? t(`failed.${job.errorCode}`) : t("failed.fallback")} action={<Button variant="secondary" onClick={restart}>{t("failed.again")}</Button>} />
      ) : stage === "review" ? (
        <ImportReview job={job} duplicateOf={duplicateOf} onChanged={refresh} onEmitted={() => void refresh()} onDiscarded={restart} />
      ) : (
        <ImportProgress job={job} onRefresh={refresh} onAnother={restart} live={{ updatedAt, changedAt, reconnecting }} />
      )}
    </div>
  );
}
