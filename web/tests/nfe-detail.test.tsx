// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NfeDetailPage from "@/app/(dashboard)/app/nfe/[id]/page";
import { ApiError } from "@/lib/api";
import type { NfeDocument } from "@/lib/nfe";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ get: vi.fn(), events: vi.fn(), sync: vi.fn(), cancel: vi.fn(), correct: vi.fn(), discard: vi.fn(), file: vi.fn(), save: vi.fn(), permissions: new Set<string>() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "n1" }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ can: (permission: string) => mocks.permissions.has(permission) }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAAA") } }));
vi.mock("@/lib/download", () => ({ saveBlob: mocks.save }));
vi.mock("@/lib/nfe", async (original) => ({
  ...(await original<typeof import("@/lib/nfe")>()),
  getNfe: mocks.get, listNfeEvents: mocks.events, syncNfe: mocks.sync, cancelNfe: mocks.cancel, correctNfe: mocks.correct, discardNfe: mocks.discard, nfeFile: mocks.file,
}));

const nfe = (over: Partial<NfeDocument> = {}) => ({
  type: "nfe", id: "n1", companyId: "c1", environment: "test", status: "authorized", series: 1, number: 12, accessKey: "3525".padEnd(44, "1"), issuedAt: null, authorizedAt: "2026-11-26T12:00:00.000Z",
  protocol: "135260000000001", cStat: "100", xMotivo: "Autorizado", cancelReason: null, cancelRequestedAt: null, natOp: "Venda de mercadoria",
  recipient: { name: "Maria da Silva", taxId: "12345678909" }, items: [{ nItem: 1, code: "SKU1", description: "Camiseta", ncm: "61091000", cfop: "5102", unit: "UN", quantity: "2.0000", unitPrice: "10.0000000000", total: "20.00" }],
  totals: { vNF: "20.00" }, additionalInfo: null, documentsReady: true, emailStatus: null, lastError: null, createdAt: "2026-11-26T11:00:00.000Z", updatedAt: "2026-11-26T12:00:00.000Z", ...over,
}) as unknown as NfeDocument;

const renderPage = async () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><NfeDetailPage /></NextIntlClientProvider>);
  await screen.findByText("Items");
};
const button = (name: string | RegExp) => screen.queryByRole("button", { name });

beforeEach(() => {
  mocks.permissions = new Set(["nfe.documents.view", "nfe.documents.issue", "nfe.documents.manage"]);
  for (const mock of [mocks.get, mocks.events, mocks.sync, mocks.cancel, mocks.correct, mocks.discard, mocks.file, mocks.save]) mock.mockReset();
  mocks.get.mockResolvedValue(nfe());
  mocks.events.mockResolvedValue([{ kind: "status", at: "2026-11-26T12:00:00.000Z", status: "authorized", from: "processing", tpEvento: null, sequence: null, eventId: null, cStat: "100", xMotivo: "Autorizado" }]);
});
afterEach(cleanup);

describe("NF-e detail", () => {
  it("authorized: offers cancel and correction letter, and the files", async () => {
    await renderPage();
    expect(button("Cancel note")).toBeTruthy();
    expect(button("Correction letter")).toBeTruthy();
    expect(button("Fix and send again")).toBeNull();
    expect(screen.queryByRole("link", { name: "Fix and send again" })).toBeNull();
    expect((button("XML") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Camiseta")).toBeTruthy();
  });

  it("issued through the SVC: says which one, the date and the reason", async () => {
    mocks.get.mockResolvedValue(nfe({ emissionType: 6, contingencyAt: "2026-11-26T15:00:00.000Z", contingencyReason: "SEFAZ de origem indisponivel" }));
    await renderPage();
    expect(screen.getByText(/Issued through the SVC-AN contingency/)).toBeTruthy();
    expect(screen.getByText(/SEFAZ de origem indisponivel/)).toBeTruthy();
  });

  it("a normal note has no SVC notice", async () => {
    mocks.get.mockResolvedValue(nfe({ emissionType: 1 }));
    await renderPage();
    expect(screen.queryByText(/contingency:/)).toBeNull();
  });

  it("rejected: offers resubmit (to the filled form) and discard, and shows the error with its hint", async () => {
    mocks.get.mockResolvedValue(nfe({ status: "rejected", documentsReady: false, lastError: { type: "validation", code: "ERROR_NCM_INVALID", message: "x", hint: "Check the NCM with your accountant" } }));
    await renderPage();
    expect(screen.getByRole("link", { name: "Fix and send again" }).getAttribute("href")).toBe("/app/nfe/new?resubmit=n1");
    expect(button("Discard")).toBeTruthy();
    expect(button("Cancel note")).toBeNull();
    expect(button("Correction letter")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(messages.ApiErrors.ncm_invalid);
    expect(screen.getByRole("alert").textContent).toContain("Check the NCM with your accountant");
    expect((button("XML") as HTMLButtonElement).disabled).toBe(true);
  });

  it("without nfe.documents.manage there is no cancel, correction, discard or sync", async () => {
    mocks.permissions = new Set(["nfe.documents.view"]);
    await renderPage();
    expect(button("Cancel note")).toBeNull();
    expect(button("Correction letter")).toBeNull();
    cleanup();
    mocks.get.mockResolvedValue(nfe({ status: "rejected" }));
    mocks.permissions = new Set(["nfe.documents.view"]);
    await renderPage();
    expect(button("Discard")).toBeNull();
    expect(screen.queryByRole("link", { name: "Fix and send again" })).toBeNull();
  });

  it("waiting for the SEFAZ: offers 'Check with the SEFAZ' and calls sync", async () => {
    mocks.get.mockResolvedValue(nfe({ status: "manual_review", documentsReady: false }));
    mocks.sync.mockResolvedValue(nfe({ status: "reconciliation_required" }));
    await renderPage();
    fireEvent.click(button("Check with the SEFAZ")!);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith("n1"));
    await screen.findByText(/We asked the SEFAZ to check/);
  });

  it("cancel asks for 15 to 255 characters before sending", async () => {
    mocks.cancel.mockResolvedValue(nfe({ status: "cancelling" }));
    await renderPage();
    fireEvent.click(button("Cancel note")!);
    const dialog = await screen.findByRole("dialog");
    const submit = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Cancel the note")!;
    fireEvent.change(screen.getByLabelText(/Reason for the cancellation/), { target: { value: "curto" } });
    fireEvent.click(submit);
    await screen.findByText("The text must have 15 to 255 characters.");
    expect(mocks.cancel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason for the cancellation/), { target: { value: "Cliente desistiu da compra" } });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("n1", "Cliente desistiu da compra"));
    await screen.findByText(/Cancellation request sent/);
  });

  it("shows the translated reason in the dialog when the SEFAZ refuses the cancellation", async () => {
    mocks.cancel.mockRejectedValue(new ApiError(422, "x", "NFE_INVALID_STATE"));
    await renderPage();
    fireEvent.click(button("Cancel note")!);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/Reason for the cancellation/), { target: { value: "Cliente desistiu da compra" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel the note" }));
    await screen.findByText(messages.ApiErrors.nfe_invalid_state);
  });

  it("sends a correction letter", async () => {
    mocks.correct.mockResolvedValue({ id: "e1" });
    await renderPage();
    fireEvent.click(button("Correction letter")!);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/What must be corrected/), { target: { value: "Corrigir o endereço de entrega" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the letter" }));
    await waitFor(() => expect(mocks.correct).toHaveBeenCalledWith("n1", "Corrigir o endereço de entrega"));
  });

  it("discards only after a confirmation", async () => {
    mocks.get.mockResolvedValue(nfe({ status: "rejected" }));
    mocks.discard.mockResolvedValue(nfe({ status: "discarded" }));
    await renderPage();
    fireEvent.click(button("Discard")!);
    await screen.findByText("Discard this NF-e?");
    expect(mocks.discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard the note" }));
    await waitFor(() => expect(mocks.discard).toHaveBeenCalledWith("n1"));
  });

  it("downloads the XML through the API file route", async () => {
    mocks.file.mockResolvedValue(new Blob(["<nfeProc/>"]));
    await renderPage();
    fireEvent.click(button("XML")!);
    await waitFor(() => expect(mocks.file).toHaveBeenCalledWith("n1", "xml"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.any(Blob), "nfe-12.xml"));
  });

  it("shows the timeline with the fiscal events", async () => {
    mocks.events.mockResolvedValue([
      { kind: "status", at: "2026-11-26T12:00:00.000Z", status: "authorized", from: "processing", tpEvento: null, sequence: null, eventId: null, cStat: "100", xMotivo: "Autorizado" },
      { kind: "event", at: "2026-11-26T13:00:00.000Z", status: "registered", from: null, tpEvento: "110110", sequence: 1, eventId: "e1", cStat: "135", xMotivo: "Evento registrado" },
    ]);
    await renderPage();
    expect(screen.getByText("Correction letter 1")).toBeTruthy();
    expect(screen.getByText("Registered")).toBeTruthy();
  });

  describe("NFC-e", () => {
    const nfce = (over: Partial<NfeDocument> = {}) => nfe({ type: "nfce", recipient: null as never, natOp: "Venda", qrCode: "https://www.nfce.fazenda.sp.gov.br/qrcode?p=abc", urlChave: "https://www.nfce.fazenda.sp.gov.br/consulta", ...over } as Partial<NfeDocument>);

    it("authorized: no correction letter; DANFCE 80 mm and A4 downloads; QR and the consult link", async () => {
      mocks.get.mockResolvedValue(nfce());
      mocks.file.mockResolvedValue(new Blob(["%PDF"]));
      await renderPage();
      expect(button("Correction letter")).toBeNull();
      expect(button("Cancel note")).toBeTruthy();
      expect(screen.getByText("Consumer not identified")).toBeTruthy();
      expect(await screen.findByRole("img", { name: "QR Code of the NFC-e" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Look up the note on the SEFAZ site" }).getAttribute("href")).toBe("https://www.nfce.fazenda.sp.gov.br/consulta");
      fireEvent.click(button("DANFCE (80 mm)")!);
      await waitFor(() => expect(mocks.file).toHaveBeenCalledWith("n1", "pdf", "80mm"));
      fireEvent.click(button("DANFCE (A4)")!);
      await waitFor(() => expect(mocks.file).toHaveBeenCalledWith("n1", "pdf", "a4"));
      expect(button("DANFE (PDF)")).toBeNull();
    });

    it("says that the cancellation is easy only in the first 30 minutes", async () => {
      mocks.get.mockResolvedValue(nfce());
      await renderPage();
      expect(screen.getByText(/30 minutes/)).toBeTruthy();
    });
  });
});
