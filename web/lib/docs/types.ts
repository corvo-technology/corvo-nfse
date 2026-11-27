// lib/docs/types.ts
export type DocsLocale = "en" | "pt";
export const DOC_LOCALES: readonly DocsLocale[] = ["en", "pt"];

export type DocGroupKey = "gettingStarted" | "reference" | "guides" | "nfe";

export type DocSlug =
  | "sdks"
  | "authentication"
  | "errors"
  | "rate-limits"
  | "companies"
  | "certificates"
  | "invoices"
  | "imports"
  | "webhooks"
  | "credits"
  | "billing"
  | "async-issuance"
  | "pagination"
  | "receiving-webhooks"
  | "integration-checklist"
  | "payment-integrations"
  | "municipalities"
  | "mcp"
  | "llms"
  | "nfe"
  | "nfe-company"
  | "nfe-issue"
  | "nfe-errors"
  | "nfe-events"
  | "nfe-files"
  | "nfce";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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

/** The searchable list of municipalities (an interactive block; the data loads on demand). */
export interface MunicipalitiesBlock {
  kind: "municipalities";
  locale: DocsLocale;
  labels: {
    searchLabel: string;
    searchPlaceholder: string;
    stateLabel: string;
    allStates: string;
    status: { all: string; emissor: string; ambiente: string; inactive: string };
    /** `{count}` is replaced with the number. */
    results: string;
    resultsOne: string;
    empty: string;
    columns: { name: string; ibge: string; status: string; since: string };
    showMore: string;
    loading: string;
    loadError: string;
    /** `{date}` is replaced with the date of the official spreadsheet. */
    source: string;
    sourceLink: string;
    /** What the markdown export says instead of the list. */
    markdown: string;
  };
}

export type DocBlock =
  | TextBlock
  | ListBlock
  | TableBlock
  | CalloutBlock
  | HeadingBlock
  | CodeBlock
  | EndpointBlock
  | MunicipalitiesBlock;

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
