import { describe, expect, it } from "vitest";
import { firstRecurringDate } from "@/lib/recurrence";

describe("firstRecurringDate", () => {
  it("weekly starts 7 days after today", () => expect(firstRecurringDate("WEEKLY", "2026-11-06")).toBe("2026-11-13"));
  it("biweekly starts 14 days after today", () => expect(firstRecurringDate("BIWEEKLY", "2026-11-06")).toBe("2026-11-20"));
  it("monthly keeps the day of the month", () => expect(firstRecurringDate("MONTHLY", "2026-11-06")).toBe("2026-12-06"));
  it("monthly rolls the year", () => expect(firstRecurringDate("MONTHLY", "2026-12-15")).toBe("2027-01-15"));
  it("monthly clamps to the last day of a shorter month", () => expect(firstRecurringDate("MONTHLY", "2027-01-31")).toBe("2027-02-28"));
});
