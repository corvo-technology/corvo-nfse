// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingCard } from "@/components/onboarding/onboarding-card";
import type { Onboarding } from "@/lib/use-onboarding";
import type { OnboardingStep, StepKey } from "@/lib/onboarding-steps";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ state: null as unknown, hide: vi.fn(), mark: vi.fn(), reload: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/use-onboarding", () => ({ useOnboarding: () => mocks.state }));
vi.mock("@/lib/api", () => ({ companies: { create: mocks.create } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("@/components/onboarding/plans-dialog", () => ({ PlansDialog: ({ open }: { open: boolean }) => (open ? <div>plans-dialog</div> : null) }));
vi.mock("@/components/dashboard/company-form", () => ({ CompanyForm: ({ onFinish, onCancel }: { onFinish: (c: { id: string }) => void; onCancel: () => void }) => <div><button onClick={() => onFinish({ id: "c1" })}>finish-company</button><button onClick={onCancel}>cancel-company</button></div> }));
vi.mock("@/components/dashboard/certificate-upload", () => ({ CertificateUpload: ({ companyId, onUploaded }: { companyId: string; onUploaded: () => void }) => <button onClick={onUploaded}>upload-for-{companyId}</button> }));
vi.mock("@/components/companies/dps-sequence-card", () => ({ DpsSequenceCard: ({ companyId }: { companyId: string }) => <div>sequence-{companyId}</div> }));

const ORDER: StepKey[] = ["plans", "company", "certificate", "numbering", "note"];
const state = (over: Partial<Onboarding> & { doneKeys?: StepKey[]; lockedNote?: boolean } = {}): Onboarding => {
  const { doneKeys = [], lockedNote = true, ...rest } = over;
  const steps: OnboardingStep[] = ORDER.map((key) => ({ key, done: doneKeys.includes(key), locked: key === "note" && lockedNote }));
  const count = steps.filter((s) => s.done).length;
  return { visible: true, loading: false, steps, firstCompanyId: "c1", done: count, total: steps.length, allDone: count === steps.length, hide: mocks.hide, mark: mocks.mark, reload: mocks.reload, ...rest } as Onboarding;
};
const renderCard = () => render(<NextIntlClientProvider locale="en" messages={messages}><OnboardingCard /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.state = state(); });
afterEach(cleanup);

describe("OnboardingCard", () => {
  it("renders nothing when it should not be visible", () => {
    mocks.state = state({ visible: false });
    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it("shows the progress and every step, and Hide asks to hide", () => {
    mocks.state = state({ doneKeys: ["company"] });
    renderCard();
    expect(screen.getByText("1 of 5")).toBeTruthy();
    for (const label of Object.values(messages.Onboarding.steps)) expect(screen.getByText(label)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(mocks.hide).toHaveBeenCalled();
  });

  it("the plans step marks itself seen and opens the plans window", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: messages.Onboarding.steps.plans }));
    expect(mocks.mark).toHaveBeenCalledWith("plansSeen");
    expect(screen.getByText("plans-dialog")).toBeTruthy();
  });

  it("the company step opens the form, and finishing it closes the window and reloads", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: messages.Onboarding.steps.company }));
    fireEvent.click(screen.getByText("finish-company"));
    expect(mocks.reload).toHaveBeenCalled();
    expect(screen.queryByText("finish-company")).toBeNull();
  });

  it("the certificate step uploads for the oldest company and reloads", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: messages.Onboarding.steps.certificate }));
    fireEvent.click(screen.getByText("upload-for-c1"));
    expect(mocks.reload).toHaveBeenCalled();
  });

  it("the numbering step shows the numbering card and can say no note was issued before", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: messages.Onboarding.steps.numbering }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("sequence-c1")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "I never issued notes before" }));
    expect(mocks.mark).toHaveBeenCalledWith("noPriorNotes");
  });

  it("a locked note step says what is missing and cannot be clicked; unlocked it links to the form", () => {
    renderCard();
    expect(screen.getByText("Register the company and upload the certificate to unlock")).toBeTruthy();
    expect(screen.queryByRole("link", { name: messages.Onboarding.steps.note })).toBeNull();
    cleanup();
    mocks.state = state({ lockedNote: false });
    renderCard();
    expect(screen.getByRole("link", { name: messages.Onboarding.steps.note }).getAttribute("href")).toBe("/app/invoices/new");
  });

  it("when everything is done it says so and points to the environment selector", () => {
    mocks.state = state({ doneKeys: ORDER, lockedNote: false });
    renderCard();
    expect(screen.getByText("All set")).toBeTruthy();
    expect(screen.getByText(/without using credits/)).toBeTruthy();
  });
});
