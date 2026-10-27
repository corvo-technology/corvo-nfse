import { DOC_GROUPS, getDocsTree } from "@/lib/docs/registry";
import { sectionToMarkdown } from "@/lib/docs/to-markdown";
import { SITE_COPY, SITE_URL, type SeoLocale, pageUrl } from "@/lib/seo";

/**
 * llms.txt and llms-full.txt for both languages, generated from the docs
 * registry so the index never lists a page that does not exist.
 */

/** Product summary and quick facts (English, unchanged from the former public/llms.txt). */
const EN_INTRO = `# Corvo

> Corvo is a REST API and MCP server to issue Brazilian service invoices (NFS-e) on the national standard. It is built for developers, SaaS products, ERPs and AI agents that need to issue notes for MEI and Simples Nacional companies without learning the tax integration.

Corvo registers issuer companies, stores their A1 certificates, calculates taxes before issuing, issues the NFS-e asynchronously, tracks every status change and delivers XML and PDF by link, webhook or email. Corvo covers NFS-e (services) only, not NF-e or NFC-e (goods and retail).

## Quick facts

- API base URL: \`https://api.corvo.tech/v1\`. Authenticate with the \`X-API-Key\` header. Keys starting with \`corvo_test_\` use the test environment (no fiscal validity); keys starting with \`corvo_live_\` issue real invoices.
- MCP server (AI agents): \`https://api.corvo.tech/mcp\`. Claude Code, Cursor, Codex, VS Code, Windsurf and Claude Desktop connect with OAuth in the browser; the user picks the workspace and the environment (test or live) on the approval screen.
- Tax regimes: MEI and Simples Nacional first; other regimes need a service tax profile.
- Issuance is asynchronous: \`POST /v1/invoices\` returns \`202\` and the result arrives by \`GET /v1/invoices/:id\` or by webhook. Send an \`Idempotency-Key\` header to retry safely.
- Corvo serves only MEI and Simples Nacional (\`taxRegime\` is \`MEI\` or \`Simples Nacional\`; other regimes return \`422 ERROR_TAX_REGIME_NOT_SUPPORTED\`) and does not generate the DAS. An ME/EPP (Simples Nacional) must send its effective Simples rate as \`simplesRate\` when the company is created (\`simplesIssRate\` is optional, for ISS withholding) and updates it with \`PATCH /v1/companies/:id\`; it is sent on every NFS-e as \`pTotTribSN\`. A MEI sends no rate.
- \`POST /v1/invoices/calculate\` shows the taxes (ISS, withholdings, IBS/CBS when they apply) without issuing, using no credit.
- Batch issuance: \`POST /v1/invoices/batches\` takes \`{ "invoices": [...] }\` with 1 to 50 items (each item has the body of \`POST /v1/invoices\` plus an optional \`idempotencyKey\`) for one company or several, and answers \`202\` with \`{ total, accepted, rejected, results }\`, one result per item in the order sent (\`index\`, \`status\` \`accepted\` or \`rejected\`, \`invoice\` or \`error\`). Valid items are saved together in one transaction; invalid items come back \`rejected\` and are not saved. Repeating a batch with the same item \`idempotencyKey\`s returns the saved invoices with \`replayed: true\`. MCP tool: \`nfse_issue_batch\`.
- Scheduled invoices: \`options.type: "SCHEDULE"\` with a future \`competenceDate\` (up to 15 days ahead).
- ISS base deduction: the optional \`deduction\` field (BRL) on \`POST /v1/invoices\` and \`POST /v1/invoices/calculate\` (and the MCP tools \`nfse_issue\` and \`nfse_calculate\`) is an amount the issuer declares to deduct from the ISS base, sent in the DPS as \`vDedRed/vDR\`. It must be greater than 0 and less than \`amount\` minus \`discount\` (\`0\` is the same as omitting it). The invoice is still issued for the full \`amount\`. The issuer is responsible for the declared value: Corvo does not check whether the deduction is allowed, and IBS/CBS and federal withholdings are not reduced by it.
- Cancellation: \`POST /v1/invoices/:id/cancel\` with a \`reason\` (\`issue_error\`, \`service_not_provided\` or \`other\`). A \`queued\` invoice is cancelled immediately (\`200\`); an \`authorized\` NFS-e returns \`202\` with status \`cancelling\` while the cancellation event is sent to the Sefin, and the result arrives by webhook (\`nfse.invoice.cancelled\` or \`nfse.invoice.cancellation_rejected\`). An invoice still being issued (\`processing\`) records the request and is cancelled as soon as it is authorized. A \`description\` of 15–255 characters is required for an issued NFS-e or one being issued. Cancelling an issued NFS-e does not refund the credit. An invoice that cannot be cancelled (\`retry_pending\`, \`reconciliation_required\`, \`manual_review\`, \`rejected\`, \`failed\`) returns \`409 ERROR_INVOICE_NOT_CANCELLABLE\`; repeating the request on a \`cancelling\` or \`cancelled\` invoice, or on one with a pending cancellation, returns its current state.
- Official SDKs in nine languages (same operations, \`X-API-Key\` auth, typed errors, webhook verification): Node.js (\`npm install corvo-nfse-node\`), Python (\`pip install corvo-nfse\`), Go (\`go get github.com/corvo-technology/corvo-nfse-go\`), PHP (\`composer require corvo-technology/corvo-nfse\`), Ruby (\`gem install corvo-nfse\`), Rust (\`cargo add corvo-nfse\`), Java (\`tech.corvo:corvo-nfse\`), Elixir (\`{:corvo_nfse, "~> 0.1.1"}\`) and .NET (\`dotnet add package Corvo.Nfse\`). Each reads \`CORVO_API_KEY\`.
- Multi-company: one account can hold many issuer companies, each with its own certificate.
- Pricing: free plan with 15 invoices a month and 1 company, no credit card. Paid plans and overage prices are public at \`GET https://api.corvo.tech/v1/plans\`.
- Source code: open source under AGPL-3.0-only.`;

const PT_INTRO = `# Corvo

> ${SITE_COPY.pt.tagline}

A Corvo cadastra empresas emissoras, guarda os certificados A1, calcula os tributos antes de emitir, emite a NFS-e de forma assíncrona, acompanha cada mudança de status e entrega XML e PDF por link, webhook ou e-mail. A Corvo cobre só NFS-e (serviços), não NF-e nem NFC-e.

## Fatos rápidos

- URL base da API: \`https://api.corvo.tech/v1\`. Autentique com o header \`X-API-Key\`. Chaves \`corvo_test_\` usam o ambiente de teste (sem valor fiscal); chaves \`corvo_live_\` emitem notas reais.
- Servidor MCP (agentes de IA): \`https://api.corvo.tech/mcp\`, com OAuth no navegador.
- Regimes: MEI e Simples Nacional.
- A emissão é assíncrona: \`POST /v1/invoices\` responde \`202\` e o resultado chega por \`GET /v1/invoices/:id\` ou por webhook. Envie \`Idempotency-Key\` para repetir com segurança.
- \`POST /v1/invoices/calculate\` mostra os tributos sem emitir.
- SDKs oficiais em nove linguagens; o Java usa a coordenada Maven \`tech.corvo:corvo-nfse\`.
- Planos e preços públicos em \`GET https://api.corvo.tech/v1/plans\`.`;

interface Labels {
  docs: string;
  optional: string;
  intro: string;
  full: string;
  fullDesc: string;
  other: string;
  otherDesc: string;
  title: string;
}

const LABELS: Record<SeoLocale, Labels> = {
  en: {
    docs: "Documentation",
    optional: "Optional",
    intro: "API introduction and quickstart",
    full: "Full documentation as one text file",
    fullDesc: "Every documentation page in English, for AI tools.",
    other: "Documentação em português (llms.txt)",
    otherDesc: "The same index in Brazilian Portuguese.",
    title: "Corvo API documentation",
  },
  pt: {
    docs: "Documentação",
    optional: "Opcional",
    intro: "Introdução à API e início rápido",
    full: "Documentação completa em um arquivo",
    fullDesc: "Todas as páginas da documentação em português, para ferramentas de IA.",
    other: "English documentation (llms.txt)",
    otherDesc: "O mesmo índice em inglês.",
    title: "Documentação da API Corvo",
  },
};

export const LLMS_PATHS: Record<SeoLocale, { index: string; full: string }> = {
  en: { index: `${SITE_URL}/llms.txt`, full: `${SITE_URL}/llms-full.txt` },
  pt: { index: `${SITE_URL}/pt/llms.txt`, full: `${SITE_URL}/pt/llms-full.txt` },
};

const allSlugs = () => DOC_GROUPS.flatMap((group) => group.slugs);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function buildLlmsTxt(locale: SeoLocale): string {
  const tree = getDocsTree(locale)!;
  const labels = LABELS[locale];
  const other: SeoLocale = locale === "en" ? "pt" : "en";
  const docs = [
    `- [${labels.intro}](${pageUrl(locale, "/docs")})`,
    ...allSlugs().map((slug) => {
      const page = tree.pages[slug];
      const description = page.description ? `: ${oneLine(page.description)}` : "";
      return `- [${page.title}](${pageUrl(locale, `/docs/${slug}`)})${description}`;
    }),
  ];
  const optional = [
    `- [${labels.full}](${LLMS_PATHS[locale].full}): ${labels.fullDesc}`,
    `- [${labels.other}](${LLMS_PATHS[other].index}): ${labels.otherDesc}`,
    `- [Corvo](${pageUrl(locale)})`,
  ];
  return [
    locale === "en" ? EN_INTRO : PT_INTRO,
    `## ${labels.docs}\n\n${docs.join("\n")}`,
    `## ${labels.optional}\n\n${optional.join("\n")}`,
  ].join("\n\n") + "\n";
}

export function buildLlmsFull(locale: SeoLocale): string {
  const tree = getDocsTree(locale)!;
  const body = [
    `# ${LABELS[locale].title}\n\n> ${SITE_COPY[locale].tagline}\n\nBase URL: https://api.corvo.tech/v1 · MCP: https://api.corvo.tech/mcp · Site: ${pageUrl(locale)}`,
    sectionToMarkdown(tree.home, 2),
    ...allSlugs().map((slug) => `${sectionToMarkdown(tree.pages[slug], 2)}\n\nSource: ${pageUrl(locale, `/docs/${slug}`)}`),
  ].join("\n\n---\n\n");
  return `${body}\n`;
}

export function markdownResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
