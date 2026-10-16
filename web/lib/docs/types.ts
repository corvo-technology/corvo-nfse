// lib/docs/types.ts
export type DocsLocale = "en" | "pt";
export const DOC_LOCALES: readonly DocsLocale[] = ["en", "pt"];

export type DocGroupKey = "gettingStarted" | "reference" | "guides";

export type DocSlug =
  | "authentication"
  | "errors"
  | "rate-limits"
  | "companies"
  | "certificates"
  | "invoices"
  | "webhooks"
  | "credits"
  | "billing"
  | "async-issuance"
  | "pagination"
  | "receiving-webhooks"
  | "integration-checklist"
  | "mcp"
  | "llms";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface TextBlock {
  kind: "text";
  body: string; // supports `code` spans
}

export interface ListBlock {
  kind: "list";
  items: string[]; // each item supports `code` spans
}

export interface TableBlock {
  kind: "table";
  head: string[];
  rows: string[][];
}

export interface CalloutBlock {
  kind: "callout";
  tone: "warn" | "accent" | "danger";
  body: string; // supports `code` spans
}

export interface HeadingBlock {
  kind: "heading";
  level: 2 | 3;
  body: string;
}

export interface CodeBlock {
  kind: "code";
  label?: string;
  language: "bash" | "json" | "js" | "text";
  code: string;
}

export interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string; // supports `code` spans
}

export interface EndpointBlock {
  kind: "endpoint";
  method: HttpMethod;
  path: string;
  scopes: string[];
  success: string; // e.g. "201 Created"
  summary: string; // supports `code` spans
  params?: { title?: string; rows: ParamRow[] };
  examples: { curl: string; node: string };
  response: { label: string; json: string };
  notes?: CalloutBlock[];
}

export type DocBlock =
  | TextBlock
  | ListBlock
  | TableBlock
  | CalloutBlock
  | HeadingBlock
  | CodeBlock
  | EndpointBlock;

export interface DocSection {
  title: string;
  description?: string;
  blocks: DocBlock[];
}

export interface DocsChrome {
  homeLabel: string;
  groups: Record<DocGroupKey, string>;
  copy: {
    copy: string;
    copied: string;
    response: string;
    close: string;
    menu: string;
    table: { field: string; type: string; required: string; description: string };
  };
  localeSwitch: Record<DocsLocale, string>;
  notFound: { title: string; body: string };
}

export interface DocsTree {
  chrome: DocsChrome;
  home: DocSection;
  pages: Record<DocSlug, DocSection>;
}
