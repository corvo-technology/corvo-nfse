import { describe, expect, it } from "vitest";
import { buildSteps, type OnboardingInput } from "@/lib/onboarding-steps";

const allowed = () => true;
const noFlags = { hidden: false, plansSeen: false, noPriorNotes: false, noteBannerDismissed: false };
const input = (over: Partial<OnboardingInput> = {}): OnboardingInput => ({
  can: allowed, hasCompany: false, hasCertificate: false, lastDpsNumber: 0, hasTestNote: false, flags: noFlags, ...over,
});
const step = (steps: ReturnType<typeof buildSteps>, key: string) => steps.find((s) => s.key === key);

describe("buildSteps", () => {
  it("starts with five steps, none done, and the note locked", () => {
    const steps = buildSteps(input());
    expect(steps.map((s) => s.key)).toEqual(["plans", "company", "certificate", "numbering", "note"]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(step(steps, "note")?.locked).toBe(true);
  });

  it("each step is done by its own fact", () => {
    expect(step(buildSteps(input({ flags: { ...noFlags, plansSeen: true } })), "plans")?.done).toBe(true);
    expect(step(buildSteps(input({ hasCompany: true })), "company")?.done).toBe(true);
    expect(step(buildSteps(input({ hasCertificate: true })), "certificate")?.done).toBe(true);
    expect(step(buildSteps(input({ hasTestNote: true })), "note")?.done).toBe(true);
  });

  it("numbering is done by a number above zero or by saying no note was issued before", () => {
    expect(step(buildSteps(input({ lastDpsNumber: 12 })), "numbering")?.done).toBe(true);
    expect(step(buildSteps(input({ flags: { ...noFlags, noPriorNotes: true } })), "numbering")?.done).toBe(true);
    expect(step(buildSteps(input()), "numbering")?.done).toBe(false);
  });

  it("the note unlocks only with a company and a certificate", () => {
    expect(step(buildSteps(input({ hasCompany: true })), "note")?.locked).toBe(true);
    expect(step(buildSteps(input({ hasCertificate: true })), "note")?.locked).toBe(true);
    expect(step(buildSteps(input({ hasCompany: true, hasCertificate: true })), "note")?.locked).toBe(false);
  });

  it("hides the steps the person has no permission for", () => {
    const keys = (can: (p: string) => boolean) => buildSteps(input({ can })).map((s) => s.key);
    expect(keys((p) => p !== "nfse.certificates.manage")).not.toContain("certificate");
    expect(keys((p) => p !== "nfse.invoices.issue")).not.toContain("note");
    expect(keys((p) => p !== "nfse.companies.manage")).toEqual(["certificate", "note"]);
    expect(keys(() => false)).toEqual([]);
  });
});
