/**
 * Municipalities on the national NFS-e standard: the data behind the docs page
 * "Municípios no padrão nacional". The file is built by scripts/build-nfse-municipalities.mjs
 * from the Receita Federal spreadsheet and the IBGE list.
 */

/** 2 = Emissor Nacional, 1 = shares notes with the national environment only, 0 = agreement not active yet. */
export type MunicipalityStatus = 0 | 1 | 2;

/** [IBGE code, name, state, status, start date (YYYY-MM-DD, or "" when unknown)] */
export type MunicipalityRow = readonly [ibge: number, name: string, uf: string, status: MunicipalityStatus, since: string];

export interface MunicipalityData {
  source: { name: string; url: string; date: string };
  counts: { total: number; emissorNacional: number; ambienteNacional: number; naoAtivo: number };
  rows: readonly MunicipalityRow[];
}

export type StatusFilter = "all" | "emissor" | "ambiente" | "inactive";

const STATUS_OF_FILTER: Record<Exclude<StatusFilter, "all">, MunicipalityStatus> = { emissor: 2, ambiente: 1, inactive: 0 };

/** Loaded on demand, so the 270 KB list is not part of the page itself. */
export async function loadMunicipalities(): Promise<MunicipalityData> {
  return (await import("@/lib/docs/data/nfse-municipios.json")).default as unknown as MunicipalityData;
}

/** "São Paulo" and "sao paulo" are the same search. */
export const normalizeSearch = (text: string): string =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export interface MunicipalityFilter {
  query: string;
  /** Two-letter state, or "" for all. */
  uf: string;
  status: StatusFilter;
}

const names = new WeakMap<readonly MunicipalityRow[], string[]>();
function normalizedNames(rows: readonly MunicipalityRow[]): string[] {
  let cached = names.get(rows);
  if (!cached) {
    cached = rows.map((row) => normalizeSearch(row[1]));
    names.set(rows, cached);
  }
  return cached;
}

/**
 * Every word of the query has to match: digits match the start of the IBGE code, a two-letter word
 * also matches the state, anything else matches inside the name. Names that start with the first
 * word come first; otherwise the list keeps its order (state, then name).
 */
export function filterMunicipalities(rows: readonly MunicipalityRow[], { query, uf, status }: MunicipalityFilter, ignoreStatus = false): MunicipalityRow[] {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const wanted = status === "all" || ignoreStatus ? null : STATUS_OF_FILTER[status];
  const lowered = normalizedNames(rows);
  const found: { row: MunicipalityRow; first: boolean }[] = [];
  rows.forEach((row, index) => {
    if (uf && row[2] !== uf) return;
    if (wanted !== null && row[3] !== wanted) return;
    const name = lowered[index];
    const matches = words.every((word) => (/^\d+$/.test(word) ? String(row[0]).startsWith(word) : name.includes(word) || (word.length === 2 && word === row[2].toLowerCase())));
    if (matches) found.push({ row, first: words.length > 0 && name.startsWith(words[0]) });
  });
  return words.length > 0 ? [...found.filter((item) => item.first), ...found.filter((item) => !item.first)].map((item) => item.row) : found.map((item) => item.row);
}

export interface StateSummary {
  uf: string;
  total: number;
  emissorNacional: number;
  ambienteNacional: number;
  naoAtivo: number;
}

export function summaryByState(rows: readonly MunicipalityRow[]): StateSummary[] {
  const byState = new Map<string, StateSummary>();
  for (const [, , uf, status] of rows) {
    const entry = byState.get(uf) ?? { uf, total: 0, emissorNacional: 0, ambienteNacional: 0, naoAtivo: 0 };
    entry.total++;
    if (status === 2) entry.emissorNacional++;
    else if (status === 1) entry.ambienteNacional++;
    else entry.naoAtivo++;
    byState.set(uf, entry);
  }
  return [...byState.values()].sort((a, b) => a.uf.localeCompare(b.uf));
}
