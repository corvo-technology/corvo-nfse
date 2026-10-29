import data from "@/lib/docs/data/nfse-municipios.json";
import { summaryByState, type MunicipalityData } from "@/lib/nfse-municipalities";
import type { DocSection, DocsLocale } from "./types";

const municipalities = data as unknown as MunicipalityData;

const COPY = {
  pt: {
    title: "Municípios no padrão nacional",
    description: "Lista oficial dos municípios brasileiros no ambiente nacional da NFS-e, com busca por nome, estado ou código IBGE.",
    intro: "A Corvo emite a NFS-e pelo ambiente nacional da Receita Federal, então importa saber como o município da sua empresa está no padrão nacional. A lista abaixo vem da tabela oficial do Portal da NFS-e e já traz o código IBGE de 7 dígitos que a API pede em `municipalityCode`.",
    readTitle: "Como ler a situação",
    statusHead: ["Situação", "O que significa", "Municípios"],
    statusRows: [
      ["Emissor Nacional", "O município adotou o emissor nacional: a nota já nasce no padrão nacional."],
      ["Só ambiente nacional", "O município aderiu e compartilha as notas com o ambiente nacional, mas mantém o emissor dele."],
      ["Convênio não ativo", "O município está cadastrado, mas o convênio ainda não está ativo."],
    ],
    warn: "Estar na lista não garante que a sua empresa consiga emitir. O CNPJ precisa estar habilitado no Emissor Nacional, com Inscrição Municipal ativa no município. Em município que só compartilha as notas, a emissão pelo ambiente nacional pode não estar disponível para a sua empresa: confirme com a prefeitura.",
    searchTitle: "Buscar município",
    stateTitle: "Por estado",
    stateHead: ["UF", "Municípios", "Emissor Nacional", "Só ambiente nacional", "Convênio não ativo"],
    sourceTitle: "Fonte e atualização",
    source: (date: string, url: string) => `Fonte: Receita Federal, Portal da NFS-e, página Monitoramento das Adesões (planilha de ${date}). O código IBGE vem da lista de municípios do IBGE. A Receita atualiza a tabela conforme os municípios aderem, e esta página é atualizada a partir dela. Em caso de divergência, vale a tabela oficial: ${url}`,
    labels: {
      searchLabel: "Buscar município",
      searchPlaceholder: "Nome, estado ou código IBGE (ex.: Campinas SP ou 3509502)",
      stateLabel: "Estado",
      allStates: "Todos os estados",
      status: { all: "Todos", emissor: "Emissor Nacional", ambiente: "Só ambiente nacional", inactive: "Convênio não ativo" },
      results: "{count} municípios",
      resultsOne: "1 município",
      empty: "Nenhum município encontrado. Confira o nome ou busque pelo código IBGE.",
      columns: { name: "Município", ibge: "Código IBGE", status: "Situação", since: "Desde" },
      showMore: "Mostrar mais {count}",
      loading: "Carregando a lista…",
      loadError: "Não foi possível carregar a lista. Recarregue a página.",
      source: "Posição de {date}. Fonte:",
      sourceLink: "Receita Federal",
      markdown: "A lista completa dos municípios, com busca, está na página da documentação. A tabela por estado abaixo resume a situação de cada estado.",
    },
  },
  en: {
    title: "Municipalities on the national standard",
    description: "Official list of Brazilian municipalities on the national NFS-e environment, searchable by name, state or IBGE code.",
    intro: "Corvo issues the NFS-e through the Receita Federal's national environment, so it matters how your company's municipality is on the national standard. The list below comes from the official table of the NFS-e Portal and already carries the 7-digit IBGE code the API asks for in `municipalityCode`.",
    readTitle: "How to read the status",
    statusHead: ["Status", "What it means", "Municipalities"],
    statusRows: [
      ["Emissor Nacional", "The municipality adopted the national issuer: the invoice is born in the national standard."],
      ["National environment only", "The municipality joined and shares its invoices with the national environment, but keeps its own issuer."],
      ["Agreement not active", "The municipality is registered, but the agreement is not active yet."],
    ],
    warn: "Being on the list does not guarantee that your company can issue. The CNPJ must be enabled in the Emissor Nacional, with an active Municipal Registration in the municipality. In a municipality that only shares its invoices, issuing through the national environment may not be available to your company: confirm with the city hall.",
    searchTitle: "Search a municipality",
    stateTitle: "By state",
    stateHead: ["State", "Municipalities", "Emissor Nacional", "National environment only", "Agreement not active"],
    sourceTitle: "Source and updates",
    source: (date: string, url: string) => `Source: Receita Federal, NFS-e Portal, Monitoramento das Adesões page (spreadsheet of ${date}). The IBGE code comes from the IBGE list of municipalities. The Receita updates the table as municipalities join, and this page is updated from it. If they differ, the official table prevails: ${url}`,
    labels: {
      searchLabel: "Search a municipality",
      searchPlaceholder: "Name, state or IBGE code (e.g. Campinas SP or 3509502)",
      stateLabel: "State",
      allStates: "All states",
      status: { all: "All", emissor: "Emissor Nacional", ambiente: "National environment only", inactive: "Agreement not active" },
      results: "{count} municipalities",
      resultsOne: "1 municipality",
      empty: "No municipality found. Check the name or search by IBGE code.",
      columns: { name: "Municipality", ibge: "IBGE code", status: "Status", since: "Since" },
      showMore: "Show {count} more",
      loading: "Loading the list…",
      loadError: "Could not load the list. Reload the page.",
      source: "As of {date}. Source:",
      sourceLink: "Receita Federal",
      markdown: "The full list of municipalities, with search, is on the documentation page. The table by state below summarizes each state.",
    },
  },
} as const;

const formatDate = (iso: string, locale: DocsLocale) =>
  new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));

/** The page "Municípios no padrão nacional": the explanation, the searchable list and the totals by state. */
export function municipalitiesPage(locale: DocsLocale): DocSection {
  const copy = COPY[locale];
  const number = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  const { counts, source } = municipalities;
  const totals = [counts.emissorNacional, counts.ambienteNacional, counts.naoAtivo];
  return {
    title: copy.title,
    description: copy.description,
    blocks: [
      { kind: "text", body: copy.intro },
      { kind: "heading", level: 2, body: copy.readTitle },
      { kind: "table", head: [...copy.statusHead], rows: copy.statusRows.map((row, i) => [...row, number.format(totals[i])]) },
      { kind: "callout", tone: "warn", body: copy.warn },
      { kind: "heading", level: 2, body: copy.searchTitle },
      {
        kind: "municipalities",
        locale,
        labels: {
          ...copy.labels,
          status: { ...copy.labels.status },
          columns: { ...copy.labels.columns },
          source: copy.labels.source.replace("{date}", formatDate(source.date, locale)),
        },
      },
      { kind: "heading", level: 2, body: copy.stateTitle },
      {
        kind: "table",
        head: [...copy.stateHead],
        rows: summaryByState(municipalities.rows).map((state) => [state.uf, ...[state.total, state.emissorNacional, state.ambienteNacional, state.naoAtivo].map((value) => number.format(value))]),
      },
      { kind: "heading", level: 2, body: copy.sourceTitle },
      { kind: "text", body: copy.source(formatDate(source.date, locale), source.url) },
    ],
  };
}
