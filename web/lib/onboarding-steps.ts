import type { OnboardingFlag } from "@/lib/onboarding-flags";

export type StepKey = "plans" | "company" | "certificate" | "numbering" | "note";

export interface OnboardingInput {
  can: (permission: string) => boolean;
  hasCompany: boolean;
  hasCertificate: boolean;
  lastDpsNumber: number;
  hasTestNote: boolean;
  flags: Record<OnboardingFlag, boolean>;
}

export interface OnboardingStep { key: StepKey; done: boolean; locked: boolean }

/** The steps this person can do, in order. Progress comes from real data; only the optional ones rely on a remembered choice. */
export function buildSteps(input: OnboardingInput): OnboardingStep[] {
  const { can, flags } = input;
  const manage = can("nfse.companies.manage");
  const steps: (OnboardingStep & { allowed: boolean })[] = [
    { key: "plans", done: flags.plansSeen, locked: false, allowed: manage },
    { key: "company", done: input.hasCompany, locked: false, allowed: manage },
    { key: "certificate", done: input.hasCertificate, locked: false, allowed: can("nfse.certificates.manage") },
    { key: "numbering", done: input.lastDpsNumber > 0 || flags.noPriorNotes, locked: false, allowed: manage },
    { key: "note", done: input.hasTestNote, locked: !(input.hasCompany && input.hasCertificate), allowed: can("nfse.invoices.issue") },
  ];
  return steps.filter((s) => s.allowed).map(({ key, done, locked }) => ({ key, done, locked }));
}
