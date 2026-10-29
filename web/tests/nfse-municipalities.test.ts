import { describe, expect, it } from "vitest";
import data from "@/lib/docs/data/nfse-municipios.json";
import { filterMunicipalities, loadMunicipalities, normalizeSearch, summaryByState, type MunicipalityData, type MunicipalityRow } from "@/lib/nfse-municipalities";

const municipalities = data as unknown as MunicipalityData;
const rows = municipalities.rows;
const find = (ibge: number) => rows.find((row) => row[0] === ibge) as MunicipalityRow;

describe("the municipalities data", () => {
  it("has every municipality of Brazil once, with a 7-digit IBGE code", () => {
    expect(rows).toHaveLength(5571);
    expect(new Set(rows.map((row) => row[0])).size).toBe(rows.length);
    for (const [ibge, name, uf, status] of rows) {
      expect(String(ibge)).toMatch(/^\d{7}$/);
      expect(name.trim()).not.toBe("");
      expect(uf).toMatch(/^[A-Z]{2}$/);
      expect([0, 1, 2]).toContain(status);
    }
    expect(new Set(rows.map((row) => row[2])).size).toBe(27);
  });

  it("states its counts, and they add up to what the rows say", () => {
    const { counts } = municipalities;
    expect(counts.total).toBe(rows.length);
    expect(counts.emissorNacional).toBe(rows.filter((row) => row[3] === 2).length);
    expect(counts.ambienteNacional).toBe(rows.filter((row) => row[3] === 1).length);
    expect(counts.naoAtivo).toBe(rows.filter((row) => row[3] === 0).length);
    expect(counts.emissorNacional + counts.ambienteNacional + counts.naoAtivo).toBe(counts.total);
  });

  it("carries the official source and date", () => {
    expect(municipalities.source.url).toBe("https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes");
    expect(municipalities.source.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("knows well-known municipalities by their IBGE code, including the renamed ones", () => {
    expect(find(3550308).slice(1, 3)).toEqual(["São Paulo", "SP"]);
    expect(find(5300108).slice(1, 3)).toEqual(["Brasília", "DF"]);
    expect(find(3304557).slice(1, 3)).toEqual(["Rio de Janeiro", "RJ"]);
    expect(find(2405306)[1]).toBe("Januário Cicco");
    expect(find(1708254)[1]).toBe("Tabocão");
  });

  it("is sorted by state and then by name", () => {
    const sorted = [...rows].sort((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1], "pt-BR"));
    expect(rows.map((row) => row[0])).toEqual(sorted.map((row) => row[0]));
  });

  it("loads on demand with the same content", async () => {
    expect((await loadMunicipalities()).rows).toHaveLength(5571);
  });
});

describe("searching municipalities", () => {
  const all = { query: "", uf: "", status: "all" as const };

  it("ignores accents and case", () => {
    expect(normalizeSearch("  São  Paulo ")).toBe("sao paulo");
    expect(filterMunicipalities(rows, { ...all, query: "SAO PAULO" }).map((row) => row[0])).toContain(3550308);
    expect(filterMunicipalities(rows, { ...all, query: "são paulo" }).map((row) => row[0])).toContain(3550308);
  });

  it("finds by the start of the IBGE code", () => {
    expect(filterMunicipalities(rows, { ...all, query: "3550308" }).map((row) => row[0])).toEqual([3550308]);
    const startingWith35 = filterMunicipalities(rows, { ...all, query: "35" });
    expect(startingWith35.length).toBeGreaterThan(600);
    expect(startingWith35.every((row) => String(row[0]).startsWith("35"))).toBe(true);
  });

  it("a name plus a state narrows to that state", () => {
    const found = filterMunicipalities(rows, { ...all, query: "campinas sp" });
    expect(found.map((row) => row[0])).toContain(3509502);
    expect(found.every((row) => row[2] === "SP")).toBe(true);
  });

  it("puts names that start with the search first", () => {
    const found = filterMunicipalities(rows, { ...all, query: "bom" });
    expect(normalizeSearch(found[0][1]).startsWith("bom")).toBe(true);
    const firstNotStarting = found.findIndex((row) => !normalizeSearch(row[1]).startsWith("bom"));
    expect(found.slice(firstNotStarting).every((row) => !normalizeSearch(row[1]).startsWith("bom"))).toBe(true);
  });

  it("filters by state and by situation, and the two combine with the search", () => {
    const pernambuco = filterMunicipalities(rows, { ...all, uf: "PE" });
    expect(pernambuco).toHaveLength(185);
    expect(pernambuco.every((row) => row[2] === "PE")).toBe(true);
    const inactive = filterMunicipalities(rows, { ...all, status: "inactive" });
    expect(inactive).toHaveLength(municipalities.counts.naoAtivo);
    expect(inactive.every((row) => row[3] === 0)).toBe(true);
    const emissorInSp = filterMunicipalities(rows, { query: "", uf: "SP", status: "emissor" });
    expect(emissorInSp.every((row) => row[2] === "SP" && row[3] === 2)).toBe(true);
  });

  it("can count a search without the situation filter, for the chips", () => {
    const withStatus = filterMunicipalities(rows, { query: "sao", uf: "", status: "emissor" });
    const ignoring = filterMunicipalities(rows, { query: "sao", uf: "", status: "emissor" }, true);
    expect(ignoring.length).toBeGreaterThan(withStatus.length);
  });

  it("finds nothing for nonsense and everything for an empty search", () => {
    expect(filterMunicipalities(rows, { ...all, query: "zzzzzz" })).toEqual([]);
    expect(filterMunicipalities(rows, all)).toHaveLength(5571);
  });
});

describe("the summary by state", () => {
  const summary = summaryByState(rows);
  it("has the 27 states in order, adding up to the totals", () => {
    expect(summary).toHaveLength(27);
    expect(summary.map((entry) => entry.uf)).toEqual([...summary.map((entry) => entry.uf)].sort());
    expect(summary.reduce((sum, entry) => sum + entry.total, 0)).toBe(5571);
    expect(summary.reduce((sum, entry) => sum + entry.emissorNacional, 0)).toBe(municipalities.counts.emissorNacional);
    expect(summary.reduce((sum, entry) => sum + entry.ambienteNacional, 0)).toBe(municipalities.counts.ambienteNacional);
    expect(summary.reduce((sum, entry) => sum + entry.naoAtivo, 0)).toBe(municipalities.counts.naoAtivo);
    for (const entry of summary) expect(entry.emissorNacional + entry.ambienteNacional + entry.naoAtivo).toBe(entry.total);
  });
});
