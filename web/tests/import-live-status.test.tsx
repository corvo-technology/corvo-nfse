// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportLiveStatus, STALLED_AFTER_MS } from "@/components/imports/import-live-status";
import messages from "@/messages/en.json";

const show = (props: { updatedAt: number | null; changedAt: number | null; reconnecting: boolean }) =>
  render(<NextIntlClientProvider locale="en" messages={messages}><ImportLiveStatus {...props} /></NextIntlClientProvider>);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T12:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ImportLiveStatus", () => {
  it("says live right after an answer, then how long ago it updated", () => {
    show({ updatedAt: Date.now(), changedAt: Date.now(), reconnecting: false });
    expect(screen.getByText("Live")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByText("Live · updated 7 s ago")).toBeTruthy();
  });

  it("says the connection is unstable while it tries again", () => {
    show({ updatedAt: Date.now(), changedAt: Date.now(), reconnecting: true });
    expect(screen.getByText(/unstable connection/i)).toBeTruthy();
  });

  it("explains when nothing has moved for a while, without calling it an error", () => {
    const changedAt = Date.now() - STALLED_AFTER_MS - 60_000;
    show({ updatedAt: Date.now(), changedAt, reconnecting: false });
    expect(screen.getByText(/nothing has changed for 3 min/i)).toBeTruthy();
  });

  it("does not talk about a stall while the numbers keep moving", () => {
    show({ updatedAt: Date.now(), changedAt: Date.now() - 30_000, reconnecting: false });
    expect(screen.queryByText(/nothing has changed/i)).toBeNull();
  });
});
