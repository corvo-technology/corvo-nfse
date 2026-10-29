// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MunicipalitiesSearch } from "@/components/docs/municipalities-search";
import data from "@/lib/docs/data/nfse-municipios.json";
import { getDocsTree } from "@/lib/docs/registry";
import { sectionToMarkdown } from "@/lib/docs/to-markdown";
import type { DocBlock, DocsLocale, MunicipalitiesBlock } from "@/lib/docs/types";
import { summaryByState, type MunicipalityData } from "@/lib/nfse-municipalities";

const municipalities = data as unknown as MunicipalityData;
const page = (locale: DocsLocale) => getDocsTree(locale)!.pages.municipalities;
const searchBlock = (locale: DocsLocale) => page(locale).blocks.find((block): block is MunicipalitiesBlock => block.kind === "municipalities")!;

afterEach(cleanup);

describe("the docs page of municipalities", () => {
  it.each(["pt", "en"] as const)("exists in %s with the explanation, the search, the totals by state and the source", (locale) => {
    const { blocks } = page(locale);
    expect(blocks.filter((block) => block.kind === "municipalities")).toHaveLength(1);
    const tables = blocks.filter((block): block is Extract<DocBlock, { kind: "table" }> => block.kind === "table");
    expect(tables).toHaveLength(2);
    expect(tables[0].rows).toHaveLength(3);
    expect(tables[1].rows).toHaveLength(27);
    expect(blocks.some((block) => block.kind === "callout" && block.tone === "warn")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes");
  });

  it("states the totals of each situation, matching the data", () => {
    const [read, byState] = page("pt").blocks.filter((block): block is Extract<DocBlock, { kind: "table" }> => block.kind === "table");
    const number = new Intl.NumberFormat("pt-BR");
    expect(read.rows.map((row) => row[2])).toEqual([municipalities.counts.emissorNacional, municipalities.counts.ambienteNacional, municipalities.counts.naoAtivo].map((value) => number.format(value)));
    const sp = byState.rows.find((row) => row[0] === "SP")!;
    const expected = summaryByState(municipalities.rows).find((state) => state.uf === "SP")!;
    expect(sp).toEqual(["SP", expected.total, expected.emissorNacional, expected.ambienteNacional, expected.naoAtivo].map((value) => (typeof value === "string" ? value : number.format(value))));
  });

  it("does not promise that being on the list means the company can issue", () => {
    for (const locale of ["pt", "en"] as const) {
      const warning = page(locale).blocks.find((block) => block.kind === "callout");
      expect(warning && "body" in warning ? warning.body : "").toMatch(locale === "pt" ? /não garante/ : /does not guarantee/);
    }
  });

  it("goes to the markdown export as a short note and the table by state, not 5,571 rows", () => {
    const markdown = sectionToMarkdown(page("en"), 2);
    expect(markdown).toContain(searchBlock("en").labels.markdown);
    expect(markdown.split("\n").length).toBeLessThan(80);
  });
});

describe("the search on the page", () => {
  const renderSearch = (locale: DocsLocale = "pt") => {
    const block = searchBlock(locale);
    return render(<MunicipalitiesSearch locale={block.locale} labels={block.labels} />);
  };
  const list = () => within(screen.getByRole("list"));

  it("loads the list, shows the first page and says how many there are", async () => {
    renderSearch();
    expect(screen.getByText("Carregando a lista…")).toBeTruthy();
    expect(await screen.findByText("5.571 municípios")).toBeTruthy();
    expect(list().getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Mostrar mais 50" })).toBeTruthy();
  });

  it("finds a municipality by name without accents, shows its IBGE code and situation", async () => {
    renderSearch();
    await screen.findByText("5.571 municípios");
    fireEvent.change(screen.getByLabelText("Buscar município"), { target: { value: "sao paulo" } });
    const row = (await screen.findByText("3550308")).closest("li")!;
    expect(within(row).getByText(/São Paulo/)).toBeTruthy();
    expect(within(row).getByText("3550308")).toBeTruthy();
    expect(within(row).getByText("Emissor Nacional")).toBeTruthy();
    expect(within(row).getByText(/2025/)).toBeTruthy();
  });

  it("finds by IBGE code and by name plus state", async () => {
    renderSearch();
    await screen.findByText("5.571 municípios");
    const input = screen.getByLabelText("Buscar município");
    fireEvent.change(input, { target: { value: "3509502" } });
    expect(await screen.findByText("1 município")).toBeTruthy();
    expect(list().getByText(/Campinas/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "campinas sp" } });
    expect(list().getAllByText(/Campinas/).length).toBeGreaterThan(0);
  });

  it("narrows by state and by situation, and the chips count the split of the narrowed list", async () => {
    renderSearch();
    await screen.findByText("5.571 municípios");
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "PE" } });
    expect(await screen.findByText("185 municípios")).toBeTruthy();
    const chips = screen.getByRole("group", { name: "Situação" });
    const only = within(chips).getByRole("button", { name: /Só ambiente nacional/ });
    const count = Number(only.textContent!.replace(/\D/g, ""));
    expect(count).toBeGreaterThan(0);
    fireEvent.click(only);
    expect(only.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(`${count} municípios`)).toBeTruthy();
    expect(list().getAllByText("Só ambiente nacional").length).toBeGreaterThan(0);
    expect(list().queryByText("Emissor Nacional")).toBeNull();
  });

  it("shows the municipalities whose agreement is not active yet", async () => {
    renderSearch();
    await screen.findByText("5.571 municípios");
    fireEvent.click(screen.getByRole("button", { name: /Convênio não ativo/ }));
    expect(await screen.findByText("28 municípios")).toBeTruthy();
  });

  it("pages through the results", async () => {
    renderSearch();
    await screen.findByText("5.571 municípios");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais 50" }));
    await waitFor(() => expect(list().getAllByRole("listitem")).toHaveLength(100));
  });

  it("says so when nothing matches", async () => {
    renderSearch();
    await screen.findByText("5.571 municípios");
    fireEvent.change(screen.getByLabelText("Buscar município"), { target: { value: "zzzzzz" } });
    expect(await screen.findByText(/Nenhum município encontrado/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("works in English and links the official source", async () => {
    renderSearch("en");
    expect(await screen.findByText("5,571 municipalities")).toBeTruthy();
    expect(screen.getByLabelText("Search a municipality")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Receita Federal" }).getAttribute("href")).toBe("https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes");
  });
});
