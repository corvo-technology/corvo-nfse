// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatusPage, { STATUS_SERVICES } from "@/app/[locale]/status/page";

describe("/status", () => {
  it("lists the components without uptime percentages or a fixed state", () => {
    const { container } = render(<StatusPage />);
    const text = container.textContent ?? "";
    for (const name of STATUS_SERVICES) expect(text).toContain(name);
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(text).not.toMatch(/uptime|operational/i);
  });

  it("has no percentage in the source", () => {
    const source = readFileSync(join(__dirname, "..", "app", "[locale]", "status", "page.tsx"), "utf8");
    expect(source).not.toMatch(/\d%/);
  });
});
