import { describe, expect, it } from "vitest";
import { getDocsTree } from "@/lib/docs/registry";

const tree = (locale: "en" | "pt") => JSON.stringify(getDocsTree(locale));

describe.each(["en", "pt"] as const)("schedules in the docs (%s)", (locale) => {
  it("documents RECURRING, its fields and the schedule answer", () => {
    const docs = tree(locale);
    for (const part of ["RECURRING", "options.recurrence.frequency", "options.recurrence.endsOn", "WEEKLY", "BIWEEKLY", "MONTHLY", "next_run_on"])
      expect(docs).toContain(part);
  });

  it("documents the schedule routes", () => {
    const docs = tree(locale);
    for (const route of ["/v1/schedules", "/v1/schedules/:id", "/v1/schedules/:id/runs", "/v1/schedules/:id/pause", "/v1/schedules/:id/resume", "/v1/schedules/:id/cancel"])
      expect(docs).toContain(route);
  });

  it("explains the run rules: 09:00 on business days, weekends on Monday, competence of the day it runs", () => {
    const docs = tree(locale);
    expect(docs).toContain("09:00");
    expect(docs).toMatch(locale === "pt" ? /segunda-feira/ : /Monday/);
    expect(docs).toMatch(locale === "pt" ? /competência do dia em que (a nota )?roda/ : /competence of the day it runs/);
  });

  it("explains the failure rule: retried on the next business day, paused after 3 attempts, e-mail", () => {
    const docs = tree(locale);
    expect(docs).toMatch(locale === "pt" ? /3 tentativas/ : /3 failed attempts/);
    expect(docs).toMatch(locale === "pt" ? /e-mail/ : /e-mail|email/);
  });

  it("says the SCHEDULE answer changed from the invoice to the schedule", () => {
    expect(tree(locale)).toMatch(locale === "pt" ? /antes devolvia a nota/ : /used to return the invoice/);
  });

  it("lists the MCP schedule tools and the new nfse_issue fields", () => {
    const docs = tree(locale);
    for (const tool of ["schedule_list", "schedule_get", "schedule_runs", "schedule_update", "schedule_pause", "schedule_resume", "schedule_cancel", "recurrence_frequency"])
      expect(docs).toContain(tool);
  });
});
