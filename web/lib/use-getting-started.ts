"use client";

import { useEffect, useState } from "react";
import { certificates, companies, invoices } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { readFlag, writeFlag } from "@/lib/onboarding-flags";

interface Facts { scope: string; companyId: string | null; hasCertificate: boolean; hasDps: boolean; established: boolean }
export type StepKey = "company" | "certificate" | "dps" | "invoice";
export interface GettingStarted {
  done: number;
  total: number;
  /** First pending step and where to go for it. */
  next: { key: StepKey; href: string };
  /** Marks numbering as done ("Nunca emiti notas antes"). */
  skipDps: () => void;
}

/**
 * Only for accounts that have not started. Four steps read from real data (company, valid certificate,
 * DPS numbering, first invoice). Hidden for established accounts: any authorized invoice in either
 * environment, or a valid certificate plus any invoice. Returns null while loading, without permission,
 * or when any request fails (never shows wrong steps from partial data).
 */
export function useGettingStarted(): GettingStarted | null {
  const { can, tenantId, fiscalEnvironment } = useAuth();
  const allowed = can("nfse.companies.manage") || can("nfse.certificates.manage") || can("nfse.invoices.issue");
  const scope = `${tenantId}:${fiscalEnvironment}`;
  const [facts, setFacts] = useState<Facts | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !allowed) return;
    const abort = new AbortController();
    (async () => {
      const page = await companies.list({ limit: 100 }, abort.signal);
      const items = [...page.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const [certificateFlags, authorizedTest, authorizedLive, anyInvoice] = await Promise.all([
        Promise.all(items.slice(0, 5).map((company) => certificates.list(company.id, { limit: 20 }, abort.signal).then((p) => p.items.some((c) => c.status === "active")))),
        invoices.list({ status: "authorized", limit: 1 }, abort.signal, "test").then((p) => p.items.length > 0),
        invoices.list({ status: "authorized", limit: 1 }, abort.signal, "live").then((p) => p.items.length > 0),
        invoices.list({ limit: 1 }, abort.signal).then((p) => p.items.length > 0),
      ]);
      const hasCertificate = certificateFlags.some(Boolean);
      const established = authorizedTest || authorizedLive || (hasCertificate && anyInvoice);
      const hasDps = !established && items[0] ? await companies.dpsSequence(items[0].id, abort.signal).then((s) => s.lastNumber > 0) : false;
      if (!abort.signal.aborted) setFacts({ scope, companyId: items[0]?.id ?? null, hasCertificate, hasDps, established });
    })().catch(() => {});
    return () => abort.abort();
  }, [tenantId, allowed, scope]);

  const current = facts?.scope === scope ? facts : null;
  if (!allowed || !current || current.established) return null;
  const hasCompany = current.companyId !== null;
  const skipFlag = hasCompany ? (`dpsSkipped:${current.companyId}` as const) : null;
  const dpsSkipped = skipFlag !== null && (skipped === skipFlag || readFlag(tenantId!, skipFlag));
  const steps = [
    { key: "company", done: hasCompany, href: "/app/companies?new=1" },
    { key: "certificate", done: current.hasCertificate, href: hasCompany ? `/app/companies/${current.companyId}#certificado` : "/app/companies?new=1" },
    { key: "dps", done: current.hasDps || dpsSkipped, href: hasCompany ? `/app/companies/${current.companyId}#numeracao` : "/app/companies?new=1" },
    { key: "invoice", done: false, href: "/app/invoices/new" },
  ] as const;
  const next = steps.find((s) => !s.done);
  if (!next) return null;
  return {
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    next: { key: next.key, href: next.href },
    skipDps: () => { if (skipFlag) { writeFlag(tenantId!, skipFlag); setSkipped(skipFlag); } },
  };
}
