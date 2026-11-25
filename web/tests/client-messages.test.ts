import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_NAMESPACES, pickClientMessages } from "@/lib/client-messages";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

const root = join(__dirname, "..");

/** Files whose useTranslations calls run in the browser on pages under app/[locale]. */
function clientFiles(): string[] {
  const landing = readdirSync(join(root, "components/landing"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `components/landing/${name}`)
    .filter((file) => readFileSync(join(root, file), "utf8").startsWith('"use client"'));
  return [
    ...landing,
    "components/pricing/plan-picker.tsx",
    "components/support/support-contacts.tsx",
    "components/ui/toast.tsx",
    "components/ui/modal.tsx",
    "components/ui/cookie-consent.tsx",
    "components/locale-switcher.tsx",
  ];
}

describe("client messages", () => {
  it("covers every namespace read by client components under app/[locale]", () => {
    const used = new Set<string>();
    for (const file of clientFiles()) {
      const source = readFileSync(join(root, file), "utf8");
      for (const match of source.matchAll(/useTranslations\(\s*"([^".]+)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const namespace of used) expect(CLIENT_NAMESPACES).toContain(namespace);
  });

  it("keeps the browser payload small and the namespaces present in both languages", () => {
    for (const messages of [en, pt]) {
      const picked = pickClientMessages(messages as Record<string, unknown>);
      expect(Object.keys(picked).sort()).toEqual([...CLIENT_NAMESPACES].sort());
      expect(JSON.stringify(picked).length).toBeLessThan(30_000);
    }
  });
});
