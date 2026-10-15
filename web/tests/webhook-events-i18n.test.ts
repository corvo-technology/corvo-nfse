import { describe, expect, it } from "vitest";
import { WEBHOOK_EVENT_OPTIONS } from "@/lib/types";
import { showsCancellationReason } from "@/lib/invoice-cancellation";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

const lookup = (messages: unknown, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages);

describe("webhook event messages", () => {
  for (const [locale, messages] of [["en", en], ["pt", pt]] as const) {
    it(`has label and description for every event in ${locale}`, () => {
      for (const { value } of WEBHOOK_EVENT_OPTIONS) {
        for (const field of ["label", "description"]) {
          expect(typeof lookup(messages, `Webhooks.events.${value}.${field}`), `${value}.${field}`).toBe("string");
        }
      }
    });
  }
});

describe("showsCancellationReason", () => {
  it("is hidden for authorized (e.g. after a rejected cancellation) and shown while cancelling or cancelled", () => {
    expect(showsCancellationReason("authorized")).toBe(false);
    expect(showsCancellationReason("cancelling")).toBe(true);
    expect(showsCancellationReason("cancelled")).toBe(true);
  });
});
