// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/components/onboarding/plans-info", () => ({ PlansInfo: () => <div>plans-info</div> }));
vi.mock("@/components/dashboard/company-form", () => ({ CompanyForm: ({ onFinish, onCancel }: { onFinish: (c: { id: string }) => void; onCancel: () => void }) => <div><button onClick={() => onFinish({ id: "c1" })}>finish-company</button><button onClick={onCancel}>cancel-company</button></div> }));
vi.mock("@/components/dashboard/certificate-upload", () => ({ CertificateUpload: ({ companyId, onUploaded }: { companyId: string; onUploaded: () => void }) => <button onClick={onUploaded}>upload-for-{companyId}</button> }));
vi.mock("@/components/companies/dps-sequence-card", () => ({ DpsSequenceCard: ({ companyId }: { companyId: string }) => <div>sequence-{companyId}</div> }));

const ORDER: StepKey[] = ["plans", "company", "certificate", "numbering", "note"];
const state = (over: Partial<Onboarding> & { doneKeys?: StepKey[]; lockedNote?: boolean; lockedKeys?: StepKey[] } = {}): Onboarding => {
  const { doneKeys = [], lockedNote = true, lockedKeys = [], ...rest } = over;
  const steps: OnboardingStep[] = ORDER.map((key) => ({ key, done: doneKeys.includes(key), locked: (key === "note" && lockedNote) || lockedKeys.includes(key) }));
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

  it("opens on the first step that is not done and says which step it is", () => {
    mocks.state = state({ doneKeys: ["plans"] });
    renderCard();
    expect(screen.getByText("Step 2 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: messages.Onboarding.steps.company })).toBeTruthy();
    expect(screen.getByText("finish-company")).toBeTruthy();
  });

  it("the plans screen is inline, marks itself seen, and Skip goes on to the next step", () => {
    renderCard();
    expect(screen.getByText("plans-info")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.mark).toHaveBeenCalledWith("plansSeen");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("heading", { name: messages.Onboarding.steps.company })).toBeTruthy();
  });

  it("a finished step shows Next, and Back returns to the previous step", () => {
    mocks.state = state({ doneKeys: ["plans"] });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(screen.getByText("plans-info")).toBeTruthy();
  });

  it("finishing the company form reloads and moves to the certificate step", () => {
    mocks.state = state({ doneKeys: ["plans"] });
    renderCard();
    fireEvent.click(screen.getByText("finish-company"));
    expect(mocks.reload).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: messages.Onboarding.steps.certificate })).toBeTruthy();
  });

  it("the certificate step uploads for the oldest company, reloads and moves on", () => {
    mocks.state = state({ doneKeys: ["plans", "company"] });
    renderCard();
    fireEvent.click(screen.getByText("upload-for-c1"));
    expect(mocks.reload).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: messages.Onboarding.steps.numbering })).toBeTruthy();
  });

  it("the numbering step shows the numbering card and can say no note was issued before", () => {
    mocks.state = state({ doneKeys: ["plans", "company", "certificate"] });
    renderCard();
    expect(screen.getByText("sequence-c1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I never issued notes before" }));
    expect(mocks.mark).toHaveBeenCalledWith("noPriorNotes");
    expect(screen.getByRole("heading", { name: messages.Onboarding.steps.note })).toBeTruthy();
  });

  it("the note step links to the form when unlocked, and says what is missing when locked", () => {
    mocks.state = state({ doneKeys: ["plans", "company", "certificate", "numbering"], lockedNote: false });
    renderCard();
    expect(screen.getByRole("link", { name: "Issue a test note" }).getAttribute("href")).toBe("/app/invoices/new");
    cleanup();
    mocks.state = state({ doneKeys: ["plans", "company", "certificate", "numbering"] });
    renderCard();
    expect(screen.getByText("Register the company and upload the certificate to unlock")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Issue a test note" })).toBeNull();
  });

  it("certificate and numbering without a company say why and can be skipped", () => {
    mocks.state = state({ doneKeys: ["plans"], firstCompanyId: null, lockedKeys: ["certificate", "numbering"] });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText("Register the company first")).toBeTruthy();
    expect(screen.queryByText("upload-for-c1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText("Register the company first")).toBeTruthy();
    expect(screen.queryByText("sequence-c1")).toBeNull();
  });

  it("the last step ends with Go to dashboard, and the top button always hides", () => {
    mocks.state = state({ doneKeys: ["plans", "company", "certificate", "numbering"] });
    renderCard();
    const buttons = screen.getAllByRole("button", { name: "Go to dashboard" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(mocks.hide).toHaveBeenCalledTimes(1);
  });

  it("when everything is done it says so and points to the environment selector", () => {
    mocks.state = state({ doneKeys: ORDER, lockedNote: false });
    renderCard();
    expect(screen.getByText("All set")).toBeTruthy();
    expect(screen.getByText(/without using credits/)).toBeTruthy();
  });
});
