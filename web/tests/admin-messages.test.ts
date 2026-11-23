import { describe, expect, it } from "vitest";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

const leaves = (value: unknown, prefix = ""): [string, unknown][] =>
  value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
    : [[prefix, value]];

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe("Admin messages", () => {
  const ptLeaves = leaves(pt.Admin);
  const enLeaves = leaves(en.Admin);

  it("exist in both languages with the same keys", () => {
    expect(ptLeaves.length).toBeGreaterThan(80);
    expect(ptLeaves.map(([key]) => key).sort()).toEqual(enLeaves.map(([key]) => key).sort());
  });
  it("have every key the brief requires", () => {
    const required = [
      "nav", "common.loadFailed", "common.loadMore", "common.empty", "common.openUser", "common.notFound", "common.yes", "common.no",
      ...["title", "users", "usersTotal", "usersNew7d", "usersNew30d", "invoicesLive", "invoicesTest", "authorized", "rejected", "rejectionRate", "today", "last7d", "last30d", "revenue", "revenueSubscription", "revenueAvulso", "revenueTotal", "revenueNote", "revenueNoteNone", "adminGrants", "adminGrantsNote"].map((k) => `overview.${k}`),
      "users.title", "users.searchPlaceholder",
      ...["email", "name", "signedUpAt", "plan", "invoicesMonth", "avulsoBalance", "companies", "lastActivity"].map((k) => `users.columns.${k}`),
      ...["title", "account", "emailVerified", "lastLogin", "workspaces", "role", "own", "plan", "usage", "balance", "companies", "certificateValidUntil", "recentInvoices", "credits", "payments", "apiKeys", "mcpConnections", "lastUsed", "grantButton"].map((k) => `detail.${k}`),
      ...["title", "amount", "reason", "confirm", "submit", "success", "successReplayed", "notify", "cancel"].map((k) => `grant.${k}`),
      ...["title", "staleInvoices", "expiringCertificates", "failingWebhooks", "failedPayments", "emptySection"].map((k) => `attention.${k}`),
      "audit.title", ...["when", "actor", "action", "target", "reason", "result"].map((k) => `audit.columns.${k}`),
      "audit.actions.credit_grant", "audit.actions.user_viewed", "audit.success", "audit.failure",
    ];
    for (const [name, list] of [["pt", ptLeaves], ["en", enLeaves]] as const) {
      const keys = new Set(list.map(([key]) => key));
      const missing = required.filter((key) => !(key === "nav" ? [...keys].some((k) => k.startsWith("nav.")) : keys.has(key)));
      expect(missing, name).toEqual([]);
    }
  });
  it("have no empty text", () => {
    for (const [key, value] of [...ptLeaves, ...enLeaves]) {
      expect(typeof value === "string" && value.trim().length > 0, key).toBe(true);
    }
  });
  it("use the same placeholders in both languages", () => {
    const enByKey = new Map(enLeaves);
    for (const [key, value] of ptLeaves) {
      expect(placeholders(value as string), key).toEqual(placeholders(enByKey.get(key) as string));
    }
  });
  it("keep the placeholders the pages rely on", () => {
    expect(placeholders(pt.Admin.grant.confirm)).toEqual(["amount", "email"]);
    expect(placeholders(pt.Admin.overview.revenueNote)).toEqual(["date"]);
  });
  it("add the sidebar entry and the idempotency error", () => {
    expect(pt.Sidebar.nav.admin).toBeTruthy();
    expect(en.Sidebar.nav.admin).toBeTruthy();
    expect(pt.ApiErrors.idempotency_key_reused).toBeTruthy();
    expect(en.ApiErrors.idempotency_key_reused).toBeTruthy();
  });
  it("never name the card processor to customers", () => {
    expect(JSON.stringify(pt.Admin) + JSON.stringify(en.Admin)).not.toMatch(/stripe/i);
  });
});
