// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { ImportReading } from "@/components/imports/import-reading";
import type { ImportJob } from "@/lib/types";
import messages from "@/messages/en.json";

const job = (rowsExpected: number | null, total: number): ImportJob => ({
  id: "i1", status: "processing", fileName: "notas.csv", companyId: null, errorCode: null, rowsExpected, emitStartedAt: null, emitFinishedAt: null, createdAt: "",
  counters: { total, valid: 0, invalid: 0, accepted: 0, authorized: 0, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 0, pending: 0, authorizedAmount: 0, pendingAmount: 0, failedAmount: 0 },
});
const show = (j: ImportJob | null) => render(<NextIntlClientProvider locale="en" messages={messages}><ImportReading job={j} /></NextIntlClientProvider>);
const step = (name: RegExp) => screen.getByText(name).closest("li");
afterEach(cleanup);

describe("ImportReading", () => {
  it("before the file is parsed, only the first step is running", () => {
    show(job(null, 0));
    expect(step(/reading the file/i)?.getAttribute("aria-current")).toBe("step");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("once the rows are known, shows how many have been checked", () => {
    show(job(300, 120));
    expect(step(/reading the file/i)?.getAttribute("data-state")).toBe("done");
    expect(step(/checking every row/i)?.getAttribute("aria-current")).toBe("step");
    expect(screen.getByText(/120 of 300 rows/i)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
  });

  it("names the file being read", () => {
    show(job(10, 5));
    expect(screen.getByText(/notas\.csv/)).toBeTruthy();
  });

  it("works before the first answer arrives", () => {
    show(null);
    expect(screen.getByRole("heading", { name: /reading the spreadsheet/i })).toBeTruthy();
  });
});
