"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { certificates, companies, invoices } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { readFlag, writeFlag, type OnboardingFlag } from "@/lib/onboarding-flags";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { buildSteps, type OnboardingStep } from "@/lib/onboarding-steps";

/** A company older than this means an established customer, not a new account. */
const NEW_ACCOUNT_DAYS = 14;
interface Facts { scope: string; established: boolean; firstCompanyId: string | null; hasCertificate: boolean; lastDpsNumber: number; hasTestNote: boolean }
const FLAGS: OnboardingFlag[] = ["hidden", "plansSeen", "noPriorNotes", "noteBannerDismissed"];
const readFlags = (tenantId: string) => Object.fromEntries(FLAGS.map((flag) => [flag, readFlag(tenantId, flag)])) as Record<OnboardingFlag, boolean>;

export interface Onboarding {
  visible: boolean;
  loading: boolean;
  steps: OnboardingStep[];
  /** The oldest company of the environment: the one steps 3 to 5 look at. */
  firstCompanyId: string | null;
  done: number;
  total: number;
  allDone: boolean;
  hide(): void;
  mark(flag: "plansSeen" | "noPriorNotes"): void;
  reload(): void;
}

/** Progress of the first-steps card, read from real data. A failing query only leaves its own step undone. */
export function useOnboarding(): Onboarding {
  const { can, tenantId, fiscalEnvironment } = useAuth();
  const billingEnabled = useBillingEnabled();
  const anyStep = can("nfse.companies.manage") || can("nfse.certificates.manage") || can("nfse.invoices.issue");
  const active = Boolean(tenantId) && fiscalEnvironment === "live" && anyStep;
  const scope = `${tenantId}:${fiscalEnvironment}`;
  const [facts, setFacts] = useState<Facts | null>(null);
  const [flagState, setFlagState] = useState<{ tenantId: string; flags: Record<OnboardingFlag, boolean> } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!active || !tenantId) return;
    const abort = new AbortController();
    (async () => {
      const page = await companies.list({ limit: 100 }, abort.signal).catch(() => null);
      const first = page ? [...page.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] : undefined;
      const [hasCertificate, lastDpsNumber, hasTestNote] = first
        ? await Promise.all([
            certificates.list(first.id, { limit: 20 }, abort.signal).then((p) => p.items.some((c) => c.status === "active")).catch(() => false),
            companies.dpsSequence(first.id).then((s) => s.lastNumber).catch(() => 0),
            invoices.list({ limit: 1 }, abort.signal).then((p) => p.items.length > 0).catch(() => false),
          ])
        : [false, 0, false];
      if (abort.signal.aborted) return;
      // Choices made in this visit stay even if the browser could not store them.
      setFlagState((previous) => {
        const stored = readFlags(tenantId);
        const kept = previous?.tenantId === tenantId ? previous.flags : null;
        return { tenantId, flags: Object.fromEntries(FLAGS.map((flag) => [flag, stored[flag] || Boolean(kept?.[flag])])) as Record<OnboardingFlag, boolean> };
      });
      const established = first ? Date.now() - new Date(first.createdAt).getTime() > NEW_ACCOUNT_DAYS * 86400000 : false;
      setFacts({ scope, established, firstCompanyId: first?.id ?? null, hasCertificate, lastDpsNumber, hasTestNote });
    })();
    return () => abort.abort();
  }, [active, tenantId, scope, revision]);

  const current = facts?.scope === scope ? facts : null;
  const flags = flagState?.tenantId === tenantId ? flagState.flags : null;
  const steps = useMemo(() => (current && flags
    ? buildSteps({ can, hasCompany: current.firstCompanyId !== null, hasCertificate: current.hasCertificate, lastDpsNumber: current.lastDpsNumber, hasTestNote: current.hasTestNote, flags, billingEnabled })
    : []), [current, flags, can, billingEnabled]);

  const setFlag = useCallback((flag: OnboardingFlag) => {
    if (!tenantId) return;
    writeFlag(tenantId, flag);
    setFlagState((state) => (state && state.tenantId === tenantId ? { ...state, flags: { ...state.flags, [flag]: true } } : state));
  }, [tenantId]);

  const done = steps.filter((s) => s.done).length;
  return {
    visible: active && Boolean(current) && !current!.established && Boolean(flags) && !flags!.hidden && steps.length > 0,
    loading: active && !current,
    steps,
    firstCompanyId: current?.firstCompanyId ?? null,
    done,
    total: steps.length,
    allDone: steps.length > 0 && done === steps.length,
    hide: () => setFlag("hidden"),
    mark: (flag) => setFlag(flag),
    reload: () => setRevision((n) => n + 1),
  };
}
