import { describe, expect, it } from "vitest";
import { getDocsTree } from "@/lib/docs/registry";

const tree = (locale: "en" | "pt") => JSON.stringify(getDocsTree(locale));
const page = (locale: "en" | "pt") => JSON.stringify(getDocsTree(locale)?.pages.imports);

describe.each(["en", "pt"] as const)("spreadsheet import in the docs (%s)", (locale) => {
  it("has its own page with the import routes, including the ones that are not endpoint blocks", () => {
    const docs = page(locale);
    for (const route of ["/v1/imports", "/v1/imports/:id", "/v1/imports/:id/rows", "/v1/imports/:id/rows/:line", "/v1/imports/:id/emit", "/v1/imports/:id/errors.csv", "/v1/imports/template"])
      expect(docs).toContain(route);
    expect(docs).toContain("DELETE");
  });

  it("shows how to upload the file with curl and from Node", () => {
    const docs = page(locale);
    expect(docs).toContain("file=@notas-novembro.csv");
    expect(docs).toContain("new FormData()");
    expect(docs).toContain("multipart/form-data");
  });

  it("lists the spreadsheet columns and the limits", () => {
    const docs = page(locale);
    for (const column of ["cnpj_prestador", "tomador_documento", "tomador_nome", "tomador_email", "descricao", "valor", "codigo_servico", "data_competencia"])
      expect(docs).toContain(column);
    expect(docs).toMatch(locale === "pt" ? /2\.000 linhas/ : /2,000 rows/);
    expect(docs).toContain("10 MB");
  });

  it("explains the counters, that awaiting_credits is not an error, and how to continue after a top-up", () => {
    const docs = page(locale);
    for (const counter of ["awaiting_credits", "valid_amount", "authorized", "rows_expected"]) expect(docs).toContain(counter);
    expect(docs).toMatch(locale === "pt" ? /não são erro/ : /not an error/);
    expect(docs).toMatch(locale === "pt" ? /chame de novo/i : /call it again|call `POST \/v1\/imports\/:id\/emit` again/i);
  });

  it("documents the error codes of the import", () => {
    const docs = page(locale);
    for (const code of ["ERROR_IMPORT_TOO_MANY_ROWS", "ERROR_IMPORT_COMPANY_REQUIRED", "ERROR_IMPORT_COMPANY_MISMATCH", "ERROR_IMPORT_STATE", "ERROR_IMPORT_FILE_TOO_LARGE"])
      expect(docs).toContain(code);
  });

  it("says reads need invoices_view and actions need invoices_issue", () => {
    const docs = page(locale);
    expect(docs).toContain("invoices_view");
    expect(docs).toContain("invoices_issue");
  });

  it("explains the rules that were tightened: merged edits, fixed company, accepted dates, ignored columns", () => {
    const docs = page(locale);
    expect(docs).toMatch(locale === "pt" ? /campo a campo/ : /field by field/);
    expect(docs).toMatch(locale === "pt" ? /não podem ser alterados/ : /cannot be changed/);
    expect(docs).toContain("unknown_columns");
    expect(docs).toContain("ERROR_IMPORT_COMPANY_NOT_FOUND");
    expect(docs).toMatch(locale === "pt" ? /7\/11\/2026/ : /7\/11\/2026/);
  });

  it("lists the MCP import tools in the MCP page, with the 1 MB limit", () => {
    const docs = tree(locale);
    for (const tool of ["import_create", "import_list", "import_get", "import_rows", "import_fix_row", "import_emit", "import_discard"])
      expect(docs).toContain(tool);
    expect(page(locale)).toContain("1 MB");
    expect(JSON.stringify(getDocsTree(locale)?.pages.mcp)).toContain("import_create");
  });
});

it("both languages describe the same routes", () => {
  const routes = (locale: "en" | "pt") => Array.from(page(locale).matchAll(/\/v1\/imports[^\s"`,)\\]*/g), (m) => m[0]).sort();
  expect(routes("en")).toEqual(routes("pt"));
});
