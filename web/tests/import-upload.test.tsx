// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportUpload } from "@/components/imports/import-upload";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ start: vi.fn(), template: vi.fn(), companies: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  imports: { start: mocks.start, template: mocks.template },
  companies: { list: mocks.companies },
}));
vi.mock("@/lib/download", () => ({ saveBlob: mocks.download }));

const csv = (name = "notas.csv", size = 10) => new File([new Uint8Array(size)], name, { type: "text/csv" });
const view = (onStarted = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><ImportUpload onStarted={onStarted} /></NextIntlClientProvider>);
  return onStarted;
};
const pick = (file: File) => fireEvent.change(screen.getByLabelText(/choose the spreadsheet/i), { target: { files: [file] } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.companies.mockResolvedValue({ items: [{ id: "c1", legalName: "Acme Ltda", taxId: "11222333000181" }], hasMore: false, nextCursor: null });
});
afterEach(cleanup);

describe("ImportUpload", () => {
  it("sends the chosen file and reports the import to follow", async () => {
    mocks.start.mockResolvedValue({ id: "i1", status: "processing", duplicateOf: null });
    const onStarted = view();
    pick(csv());
    fireEvent.click(screen.getByRole("button", { name: /upload spreadsheet/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ id: "i1", status: "processing", duplicateOf: null }));
    expect(mocks.start).toHaveBeenCalledWith(expect.any(File), undefined);
  });

  it("sends the chosen company along", async () => {
    mocks.start.mockResolvedValue({ id: "i1", status: "processing", duplicateOf: null });
    view();
    await screen.findByRole("option", { name: /acme/i });
    fireEvent.change(screen.getByLabelText(/issuing company/i), { target: { value: "c1" } });
    pick(csv("n.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: /upload spreadsheet/i }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith(expect.any(File), "c1"));
  });

  it("refuses a file that is not csv or xlsx, or is over 10 MB, without calling the API", () => {
    view();
    pick(csv("notas.pdf"));
    expect(screen.getByRole("alert").textContent).toMatch(/\.csv or \.xlsx/i);
    pick(csv("grande.csv", 10 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert").textContent).toMatch(/10 MB/);
    expect((screen.getByRole("button", { name: /upload spreadsheet/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("keeps the send button off until a file is chosen", () => {
    view();
    expect((screen.getByRole("button", { name: /upload spreadsheet/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the API error and lets the user try again", async () => {
    mocks.start.mockRejectedValue(new ApiError(429, "Too many requests"));
    view();
    pick(csv());
    fireEvent.click(screen.getByRole("button", { name: /upload spreadsheet/i }));
    expect((await screen.findByRole("alert")).textContent).toBe("Too many requests");
    expect((screen.getByRole("button", { name: /upload spreadsheet/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("downloads the template", async () => {
    const blob = new Blob(["a;b"]);
    mocks.template.mockResolvedValue(blob);
    view();
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(blob, "modelo-importacao.csv"));
  });

  it("shows the chosen file with its size and, for a csv, how many rows it has", async () => {
    view();
    pick(new File(["valor\n1\n2\n3\n"], "notas.csv", { type: "text/csv" }));
    expect(screen.getByText("notas.csv")).toBeTruthy();
    expect(await screen.findByText(/3 rows/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove file/i }));
    expect(screen.queryByText("notas.csv")).toBeNull();
    expect((screen.getByRole("button", { name: /upload spreadsheet/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reacts while a file is dragged over the page, and takes the dropped file", () => {
    view();
    fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText(/drop to upload/i)).toBeTruthy();
    fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [csv("solto.csv")] } });
    expect(screen.queryByText(/drop to upload/i)).toBeNull();
    expect(screen.getByText("solto.csv")).toBeTruthy();
  });

  it("stops the drag highlight when the file leaves the page, and ignores drags that are not files", () => {
    view();
    fireEvent.dragEnter(window, { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByText(/drop to upload/i)).toBeNull();
    fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragLeave(window, { dataTransfer: { types: ["Files"] }, relatedTarget: null });
    expect(screen.queryByText(/drop to upload/i)).toBeNull();
  });

  it("refuses a dropped file of the wrong kind with the same message as the picker", () => {
    view();
    fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [csv("foto.png")] } });
    expect(screen.getByRole("alert").textContent).toMatch(/\.csv or \.xlsx/i);
  });
});
