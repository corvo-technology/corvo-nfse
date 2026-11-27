// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { NfeStatusBadge } from "@/components/nfe/nfe-status-badge";
import { NFE_STATUSES, isNfePending, nfeActions } from "@/lib/nfe";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

afterEach(cleanup);

describe("contingency_pending", () => {
  it("is a known status with a text in both languages", () => {
    expect(NFE_STATUSES).toContain("contingency_pending");
    expect(Object.keys(en.Nfe.status).sort()).toEqual([...NFE_STATUSES].sort());
    expect(Object.keys(pt.Nfe.status).sort()).toEqual([...NFE_STATUSES].sort());
  });

  it("shows the badge in plain words", () => {
    render(<NextIntlClientProvider locale="en" messages={en}><NfeStatusBadge status="contingency_pending" /></NextIntlClientProvider>);
    expect(screen.getByText("Issued offline, to be sent")).toBeTruthy();
  });

  it("keeps the page watching and lets the consumer note be downloaded", () => {
    expect(isNfePending("contingency_pending")).toBe(true);
    expect(nfeActions({ status: "contingency_pending", documentsReady: false, type: "nfce" }, () => true).download).toBe(true);
    expect(nfeActions({ status: "queued", documentsReady: false, type: "nfce" }, () => true).download).toBe(false);
  });
});
