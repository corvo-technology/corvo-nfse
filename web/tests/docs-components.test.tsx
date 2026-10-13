// tests/docs-components.test.tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InlineText } from "@/components/docs/inline-text";
import { Callout } from "@/components/docs/callout";
import { ParamTable } from "@/components/docs/param-table";
import { CodeWindow } from "@/components/docs/code-window";
import { EndpointCard } from "@/components/docs/endpoint-card";
import { DocBlocks } from "@/components/docs/doc-blocks";
import type { DocsChrome, EndpointBlock } from "@/lib/docs/types";

afterEach(cleanup);

it("InlineText renders backtick spans as code elements", () => {
  const { container } = render(<InlineText body="Use `X-API-Key` always" />);
  const code = container.querySelector("code");
  expect(code?.textContent).toBe("X-API-Key");
  expect(container.textContent).toBe("Use X-API-Key always");
});

it("Callout maps tone to banner class", () => {
  const { container } = render(<Callout tone="warn" body="careful" />);
  expect(container.querySelector(".banner-warn")).not.toBeNull();
});

it("ParamTable renders rows and marks required fields", () => {
  render(
    <ParamTable
      rows={[
        { name: "taxId", type: "string", required: true, description: "CNPJ" },
        { name: "tradeName", type: "string", required: false, description: "optional" },
      ]}
      labels={{ field: "Field", type: "Type", required: "Required", description: "Description" }}
    />,
  );
  expect(screen.getByText("taxId")).toBeDefined();
  expect(screen.getByText("Required")).toBeDefined();
  const cells = screen.getAllByRole("cell").map((c) => c.textContent);
  expect(cells).toContain("✓");
  expect(cells).toContain("—");
});

it("CodeWindow switches tabs and copies", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CodeWindow curl="curl one" node="node two" copyLabel="Copy" copiedLabel="Copied" />);
  expect(screen.getByText("curl one")).toBeDefined();
  fireEvent.click(screen.getByText("JavaScript"));
  expect(screen.getByText("node two")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("node two");
});

const copy = {
  copy: "Copy",
  copied: "Copied",
  response: "Response",
  close: "Close",
  menu: "Menu",
  table: { field: "Field", type: "Type", required: "Required", description: "Description" },
} as const satisfies DocsChrome["copy"];

const endpoint: EndpointBlock = {
  kind: "endpoint",
  method: "POST",
  path: "/v1/companies",
  scopes: ["full_access"],
  success: "201 Created",
  summary: "Registers a company.",
  params: { rows: [{ name: "taxId", type: "string", required: true, description: "CNPJ" }] },
  examples: { curl: "curl ...", node: "fetch ..." },
  response: { label: "201 Created", json: '{ "data": { "id": "abc" } }' },
  notes: [{ kind: "callout", tone: "warn", body: "Duplicate CNPJ returns `409`." }],
};

it("EndpointCard renders method, path, scopes, examples, response and notes", () => {
  const { container } = render(<EndpointCard block={endpoint} copy={copy} />);
  expect(screen.getByText("POST")).toBeDefined();
  expect(screen.getByText("/v1/companies")).toBeDefined();
  expect(screen.getByText("full_access")).toBeDefined();
  expect(screen.getAllByText("201 Created").length).toBe(2); // success badge + response label
  expect(screen.getByText("curl ...")).toBeDefined();
  expect(container.querySelector(".banner-warn")).not.toBeNull();
});

it("EndpointCard renders empty response body without faking JSON", () => {
  render(
    <EndpointCard
      block={{ ...endpoint, method: "DELETE", success: "204 No Content", response: { label: "204 No Content", json: "" }, params: undefined, notes: undefined }}
      copy={copy}
    />,
  );
  expect(screen.getAllByText("204 No Content").length).toBeGreaterThan(0);
  expect(screen.queryByText("{")).toBeNull();
});

it("DocBlocks renders the whole block union", () => {
  render(
    <DocBlocks
      copy={copy}
      blocks={[
        { kind: "heading", level: 2, body: "Overview" },
        { kind: "text", body: "Some `code` here" },
        { kind: "list", items: ["first", "second"] },
        { kind: "table", head: ["A", "B"], rows: [["1", "2"]] },
        { kind: "code", language: "json", code: "{}" },
        { kind: "callout", tone: "accent", body: "tip" },
        endpoint,
      ]}
    />,
  );
  expect(screen.getByRole("heading", { level: 2, name: "Overview" })).toBeDefined();
  expect(screen.getByText("first")).toBeDefined();
  expect(screen.getByText("A")).toBeDefined();
});
