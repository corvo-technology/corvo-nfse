"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ImportProgress } from "@/components/imports/import-progress";
import { ImportReview } from "@/components/imports/import-review";
import { ImportUpload } from "@/components/imports/import-upload";
import { useAuth } from "@/lib/auth";
import { importStage } from "@/lib/imports";
import type { ImportStart } from "@/lib/types";
import { useImport } from "@/lib/use-import";

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
  const { job, error, refresh } = useImport(id);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const restart = () => { setDuplicateOf(null); router.replace(HOME); };
  const started = (start: ImportStart) => { setDuplicateOf(start.duplicateOf); router.replace(`${HOME}?id=${encodeURIComponent(start.id)}`); };

  if (!can("nfse.invoices.issue")) return null;
  const stage = id ? importStage(job) : "upload";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/app/invoices" className="inline-flex w-fit items-center gap-1.5 text-[13.5px] text-text-3 hover:text-text"><ArrowLeft size={14} aria-hidden />{t("back")}</Link>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
      </div>

      {id && error ? (
        <EmptyState tone="danger" title={t("failed.title")} description={t("failed.fallback")} action={<Button variant="secondary" onClick={restart}>{t("failed.again")}</Button>} />
      ) : stage === "upload" ? (
        <ImportUpload onStarted={started} />
      ) : !job ? (
        <Reading />
      ) : stage === "reading" ? (
        <Reading />
      ) : stage === "failed" ? (
        <EmptyState tone="danger" title={t("failed.title")} description={job.errorCode && t.has(`failed.${job.errorCode}`) ? t(`failed.${job.errorCode}`) : t("failed.fallback")} action={<Button variant="secondary" onClick={restart}>{t("failed.again")}</Button>} />
      ) : stage === "review" ? (
        <ImportReview job={job} duplicateOf={duplicateOf} onChanged={refresh} onEmitted={() => void refresh()} onDiscarded={restart} />
      ) : (
        <ImportProgress job={job} onRefresh={refresh} onAnother={restart} />
      )}
    </div>
  );
}

function Reading() {
  const t = useTranslations("Imports");
  return (
    <div role="status" className="flex max-w-[620px] items-start gap-3.5 rounded-[12px] border border-border p-6">
      <Loader2 size={20} aria-hidden className="mt-0.5 animate-spin text-text-3" />
      <div>
        <h2 className="text-[16px] font-semibold text-text">{t("reading.title")}</h2>
        <p className="mt-1 text-[14px] text-text-3">{t("reading.body")}</p>
      </div>
    </div>
  );
}
