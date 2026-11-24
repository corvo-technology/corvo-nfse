"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { certificates, companies, invoices } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { readFlag, writeFlag } from "@/lib/onboarding-flags";
import { Card } from "@/components/ui/card";

interface Facts { scope: string; companyId: string | null; hasCertificate: boolean; hasInvoice: boolean; hasDps: boolean }

/**
 * "Comece por aqui": four steps read from real data (company, valid certificate, DPS numbering, authorized
 * invoice in production). The numbering step is skippable: it counts as done once the sequence moved, the user says they never issued, or a live note exists. Disappears when all are done. A failing query only leaves its own step pending.
 */
export function GettingStartedCard() {
  const t = useTranslations("GettingStarted");
  const { can, tenantId, fiscalEnvironment } = useAuth();
  const allowed = can("nfse.companies.manage") || can("nfse.certificates.manage") || can("nfse.invoices.issue");
  const scope = `${tenantId}:${fiscalEnvironment}`;
  const [facts, setFacts] = useState<Facts | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !allowed) return;
    const abort = new AbortController();
    (async () => {
      const page = await companies.list({ limit: 100 }, abort.signal).catch(() => null);
      const items = page ? [...page.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
      const [hasCertificate, hasInvoice] = await Promise.all([
        Promise.all(items.slice(0, 5).map((company) => certificates.list(company.id, { limit: 20 }, abort.signal).then((p) => p.items.some((c) => c.status === "active")).catch(() => false))).then((r) => r.some(Boolean)),
        // Only the production environment counts; the test environment cannot tell.
        fiscalEnvironment === "live" ? invoices.list({ status: "authorized", limit: 1 }, abort.signal).then((p) => p.items.length > 0).catch(() => false) : Promise.resolve(false),
      ]);
      const hasDps = items[0] ? await companies.dpsSequence(items[0].id, abort.signal).then((s) => s.lastNumber > 0).catch(() => false) : false;
      if (!abort.signal.aborted) setFacts({ scope, companyId: items[0]?.id ?? null, hasCertificate, hasInvoice, hasDps });
    })();
    return () => abort.abort();
  }, [tenantId, allowed, scope, fiscalEnvironment]);

  const current = facts?.scope === scope ? facts : null;
  if (!allowed || !current) return null;
  const hasCompany = current.companyId !== null;
  const skipFlag = hasCompany ? (`dpsSkipped:${current.companyId}` as const) : null;
  const dpsSkipped = skipFlag !== null && (skipped === skipFlag || readFlag(tenantId!, skipFlag));
  const steps = [
    { key: "company", done: hasCompany, href: "/app/companies" },
    { key: "certificate", done: current.hasCertificate, href: hasCompany ? `/app/companies/${current.companyId}` : "/app/companies" },
    { key: "dps", done: current.hasDps || current.hasInvoice || dpsSkipped, href: hasCompany ? `/app/companies/${current.companyId}#numeracao` : "/app/companies" },
    { key: "invoice", done: current.hasInvoice, href: "/app/invoices/new" },
  ] as const;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const firstOpen = steps.findIndex((s) => !s.done);

  return (
    <Card className="dash-in p-5 sm:p-6" data-testid="getting-started">
      <section aria-labelledby="getting-started-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="getting-started-title" className="text-[17px] font-medium tracking-tight">{t("title")}</h2>
            <p className="mt-1 text-[13px] text-text-3">{t("subtitle")}</p>
          </div>
          <div className="flex flex-none flex-col items-end gap-1.5">
            <span className="text-[13px] font-medium tabular-nums text-text-2">{t("progress", { done, total: steps.length })}</span>
            <div className="h-1 w-20 overflow-hidden rounded-full bg-border-strong" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
            </div>
          </div>
        </div>
        <ol className="mt-4 flex flex-col divide-y divide-border">
          {steps.map((step, index) => (
            <li key={step.key} data-done={step.done} className="flex items-center gap-3 py-3">
              <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border font-mono text-[11px] ${step.done ? "border-accent bg-accent text-bg" : "border-border-strong text-text-3"}`}>
                {step.done ? <Check size={12} strokeWidth={3} aria-hidden /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`text-[14px] ${step.done ? "text-text-3 line-through" : "text-text"}`}>{t(`steps.${step.key}.title`)}</span>
                {!step.done && <span className="text-[12.5px] text-text-3">{t(`steps.${step.key}.hint`)}</span>}
              </span>
              <span className="sr-only">{step.done ? t("done") : t("pending")}</span>
              {!step.done && (
                <span className="flex flex-none flex-wrap items-center justify-end gap-2">
                  {step.key === "dps" && skipFlag && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => { writeFlag(tenantId!, skipFlag); setSkipped(skipFlag); }}>{t("steps.dps.skip")}</button>
                  )}
                  <Link href={step.href} className={`btn btn-sm ${index === firstOpen ? "btn-accent" : "btn-secondary"}`}>{t(`steps.${step.key}.cta`)}</Link>
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </Card>
  );
}
