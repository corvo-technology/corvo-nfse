import { describe, expect, it } from "vitest";
import { formatScheduledDate, isScheduled } from "@/lib/invoice-schedule";

const now = Date.parse("2026-10-18T12:00:00Z");

describe("isScheduled", () => {
  it("is true for a queued invoice released in the future", () => {
    expect(isScheduled({ status: "queued", scheduledFor: "2026-10-26T03:00:00Z" }, now)).toBe(true);
  });
  it("is false once the release time has passed", () => {
    expect(isScheduled({ status: "queued", scheduledFor: "2026-10-18T03:00:00Z" }, now)).toBe(false);
  });
  it("is false for immediate invoices and other statuses", () => {
    expect(isScheduled({ status: "queued", scheduledFor: null }, now)).toBe(false);
    expect(isScheduled({ status: "processing", scheduledFor: "2026-10-26T03:00:00Z" }, now)).toBe(false);
  });
});

describe("formatScheduledDate", () => {
  it("uses the Sao Paulo calendar day", () => {
    expect(formatScheduledDate("2026-10-26T03:00:00Z", "pt")).toContain("26");
  });
});
