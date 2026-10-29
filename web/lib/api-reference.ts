import { DOC_GROUPS, getDocsTree } from "@/lib/docs/registry";
import type { DocSlug, EndpointBlock, TableBlock } from "@/lib/docs/types";
import type { SeoLocale } from "@/lib/seo";

export const API_DOCS_PATH = "/api-docs";

export interface ReferenceEndpoint {
  method: string;
  path: string;
  success: string;
  summary: string;
  scopes: string[];
}

export interface ReferenceSection {
  slug: DocSlug;
  title: string;
  endpoints: ReferenceEndpoint[];
}

/** Every endpoint in the docs registry, grouped by docs page, in sidebar order. */
export function apiReference(locale: SeoLocale): { sections: ReferenceSection[]; errorTables: TableBlock[] } {
  const tree = getDocsTree(locale)!;
  const sections = DOC_GROUPS.flatMap((group) => group.slugs)
    .map((slug) => {
      const page = tree.pages[slug];
      const endpoints = page.blocks
        .filter((block): block is EndpointBlock => block.kind === "endpoint")
        .map(({ method, path, success, summary, scopes }) => ({ method, path, success, summary, scopes }));
      return { slug, title: page.title, endpoints };
    })
    .filter((section) => section.endpoints.length > 0);
  const errorTables = tree.pages.errors.blocks.filter((block): block is TableBlock => block.kind === "table");
  return { sections, errorTables };
}

export const API_DOCS_COPY: Record<SeoLocale, { title: string; description: string; intro: string; errors: string; method: string; endpoint: string; success: string; summary: string; more: string }> = {
  pt: {
    title: "Referência da API de NFS-e",
    description: "Todos os endpoints da API REST da Corvo para emitir NFS-e: métodos, caminhos, códigos de status de sucesso e erros.",
    intro: "Base URL: `https://api.corvo.tech/v1`. Autenticação pelo header `X-API-Key`. Cada seção leva à página da documentação com parâmetros e exemplos.",
    errors: "Erros",
    method: "Método",
    endpoint: "Endpoint",
    success: "Sucesso",
    summary: "Descrição",
    more: "Detalhes e exemplos",
  },
  en: {
    title: "NFS-e API reference",
    description: "Every endpoint of the Corvo REST API to issue NFS-e: methods, paths, success status codes and errors.",
    intro: "Base URL: `https://api.corvo.tech/v1`. Authenticate with the `X-API-Key` header. Each section links to the docs page with parameters and examples.",
    errors: "Errors",
    method: "Method",
    endpoint: "Endpoint",
    success: "Success",
    summary: "Description",
    more: "Details and examples",
  },
};
