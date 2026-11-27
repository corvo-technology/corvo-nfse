import { POSTS, postToMarkdown } from "@/lib/blog/registry";
import { blogUrl, postUrl } from "@/lib/blog/seo";
import { DOC_GROUPS, getDocsTree } from "@/lib/docs/registry";
import { sectionToMarkdown } from "@/lib/docs/to-markdown";
import { faqMarkdown } from "@/lib/landing-faq";
import { SITE_COPY, SITE_URL, type SeoLocale, pageUrl } from "@/lib/seo";

/**
 * llms.txt and llms-full.txt for both languages, generated from the docs
 * registry so the index never lists a page that does not exist.
 */

/** Product summary and quick facts (English, unchanged from the former public/llms.txt). */
const EN_INTRO = `# Corvo

> Corvo is a REST API and MCP server to issue Brazilian service invoices (NFS-e) on the national standard. It is built for developers, SaaS products, ERPs and AI agents that need to issue notes for MEI and Simples Nacional companies without learning the tax integration.

Corvo registers issuer companies, stores their A1 certificates, calculates taxes before issuing, issues the NFS-e asynchronously, tracks every status change and delivers XML and PDF by link, webhook or email. Corvo covers NFS-e (services). NF-e (goods, model 55) exists only in test mode (homologação), for Simples Nacional companies in SP and SVRS states, in accounts where it was released; it uses the same \`/v1/invoices\` routes with \`type: "nfe"\` (see the NF-e docs pages) and Corvo does not calculate its taxes. NFC-e (retail) is not covered.

## Quick facts

- API base URL: \`https://api.corvo.tech/v1\`. Authenticate with the \`X-API-Key\` header. Keys starting with \`corvo_test_\` use the test environment (no fiscal validity); keys starting with \`corvo_live_\` issue real invoices.
- MCP server (AI agents): \`https://api.corvo.tech/mcp\`. Claude Code, Cursor, Codex, VS Code, Windsurf and Claude Desktop connect with OAuth in the browser; the user picks the workspace and the environment (test or live) on the approval screen.
- MCP agent flow: \`cnpj_lookup\` → \`company_create\` → \`certificate_upload\` → \`company_fiscal_status\` → \`nfse_issue\` → \`credits_balance\` → \`credits_purchase\` → \`payment_status\` → keep issuing. The person always completes the payment (card or Pix).
- MCP \`certificate_upload\` (optional scope \`nfse:certificates\`): \`tax_id\`, \`pfx_base64\` (up to 50 KB), \`password\`. The password stays in the agent's vault; Corvo stores it encrypted and never returns it.
- MCP \`credits_purchase\` (optional scope \`billing:purchase\`): \`units\` and \`method\` (\`pix\` or \`card\`); returns the Pix QR Code and copy-and-paste code or the card checkout link. Not available on self-hosted installs.
- MCP \`payment_status\` (scope \`billing:purchase\`): \`payment_id\` or \`session_id\`; returns pending, paid (with the new balance) or expired/cancelled.
- MCP \`nfse_review\` (scope \`nfse:write\`): \`invoice_id\` and \`action\` (\`retry\` or \`discard\`) for an invoice in \`manual_review\`. \`retry\` asks the portal about the same DPS and never issues a second NFS-e; \`discard\` rejects only if the portal confirms the DPS was never registered (the number is skipped).
- Tax regimes: MEI and Simples Nacional only.
- Issuance is asynchronous: \`POST /v1/invoices\` returns \`202\` and the result arrives by \`GET /v1/invoices/:id\` or by webhook. Send an \`Idempotency-Key\` header to retry safely.
- Corvo serves only MEI and Simples Nacional (\`taxRegime\` is \`MEI\` or \`Simples Nacional\`; other regimes return \`422 ERROR_TAX_REGIME_NOT_SUPPORTED\`) and does not generate the DAS. An ME/EPP (Simples Nacional) must send its effective Simples rate as \`simplesRate\` when the company is created (\`simplesIssRate\` is optional, for ISS withholding) and updates it with \`PATCH /v1/companies/:id\`; it is sent on every NFS-e as \`pTotTribSN\`. A MEI sends no rate.
- \`POST /v1/invoices/calculate\` shows the taxes (ISS, withholdings, IBS/CBS when they apply) without issuing, using no credit.
- Batch issuance: \`POST /v1/invoices/batches\` takes \`{ "invoices": [...] }\` with 1 to 50 items (each item has the body of \`POST /v1/invoices\` plus an optional \`idempotencyKey\`) for one company or several, and answers \`202\` with \`{ total, accepted, rejected, results }\`, one result per item in the order sent (\`index\`, \`status\` \`accepted\` or \`rejected\`, \`invoice\` or \`error\`). Valid items are saved together in one transaction; invalid items come back \`rejected\` and are not saved. Repeating a batch with the same item \`idempotencyKey\`s returns the saved invoices with \`replayed: true\`. MCP tool: \`nfse_issue_batch\`.
- Scheduled invoices: \`options.type: "SCHEDULE"\` with a future \`competenceDate\` (up to 15 days ahead).
- ISS base deduction: the optional \`deduction\` field (BRL) on \`POST /v1/invoices\` and \`POST /v1/invoices/calculate\` (and the MCP tools \`nfse_issue\` and \`nfse_calculate\`) is an amount the issuer declares to deduct from the ISS base, sent in the DPS as \`vDedRed/vDR\`. It must be greater than 0 and less than \`amount\` minus \`discount\` (\`0\` is the same as omitting it). The invoice is still issued for the full \`amount\`. The issuer is responsible for the declared value: Corvo does not check whether the deduction is allowed, and IBS/CBS and federal withholdings are not reduced by it.
- Cancellation: \`POST /v1/invoices/:id/cancel\` with a \`reason\` (\`issue_error\`, \`service_not_provided\` or \`other\`). A \`queued\` invoice is cancelled immediately (\`200\`); an \`authorized\` NFS-e returns \`202\` with status \`cancelling\` while the cancellation event is sent to the Sefin, and the result arrives by webhook (\`nfse.invoice.cancelled\` or \`nfse.invoice.cancellation_rejected\`). An invoice still being issued (\`processing\`) records the request and is cancelled as soon as it is authorized. A \`description\` of 15–255 characters is required for an issued NFS-e or one being issued. Cancelling an issued NFS-e does not refund the credit. An invoice that cannot be cancelled (\`retry_pending\`, \`reconciliation_required\`, \`manual_review\`, \`rejected\`, \`failed\`) returns \`409 ERROR_INVOICE_NOT_CANCELLABLE\`; repeating the request on a \`cancelling\` or \`cancelled\` invoice, or on one with a pending cancellation, returns its current state.
- Purchase order and notes: the optional \`purchaseOrder\` (up to 60 characters) and \`notes\` (up to 2,000) on \`POST /v1/invoices\` are printed on the invoice (DPS \`serv/infoCompl/xPed\` and \`xInfComp\`) and change no tax. Batches, schedules, spreadsheets (columns \`pedido\` and \`observacoes\`) and the MCP tools (\`purchase_order\`, \`notes\`) accept them too.
- Saved customers: after an invoice with a customer is accepted, Corvo keeps the CPF/CNPJ, the name and the email. On the next invoice for the same document, \`customer.taxId\` alone is enough: the \`name\` is filled from the saved customer (what the request carries always wins; without a saved customer the name falls back to \`Consumidor\`). Manage them with \`GET /v1/customers?search=\`, \`GET\`, \`PATCH\` and \`DELETE /v1/customers/:taxId\`. MCP tools: \`customer_list\`, \`customer_update\`, \`customer_delete\`.
- Customer abroad: send \`customer.foreign\` (\`taxId\` or \`noTaxIdReason\`, \`country\` in ISO2 other than BR, \`postalCode\`, \`city\`, \`region\`, \`street\`, \`number\`, \`district\`) instead of \`customer.taxId\`; \`customer.name\` is then required. The DPS identifies the customer by NIF with the address abroad. It does not declare a service export: the tax treatment does not change, and exports are not supported yet.
- Substitution: \`POST /v1/invoices/:id/substitute\` with a \`description\` (15 to 255 characters) issues a new invoice that replaces an \`authorized\` one; only \`service.description\`, \`purchaseOrder\` and \`notes\` can change (for MEI and Simples Nacional the Sefin refuses a substitute that changes the customer, the competence date or the amount). It answers \`202\` with the substitute in \`queued\` and \`substitutesInvoiceId\`. The original becomes \`cancelled\` only after the substitute is authorized (webhook \`nfse.invoice.cancelled\` with \`substitutedBy\`); a refusal leaves it authorized. The substitute uses a credit. An invoice that is not \`authorized\` returns \`409 ERROR_INVOICE_NOT_SUBSTITUTABLE\`. MCP tool: \`nfse_substitute\`.
- Official SDKs in nine languages (same operations, \`X-API-Key\` auth, typed errors, webhook verification): Node.js (\`npm install corvo-nfse-node\`), Python (\`pip install corvo-nfse\`), Go (\`go get github.com/corvo-technology/corvo-nfse-go\`), PHP (\`composer require corvo-technology/corvo-nfse\`), Ruby (\`gem install corvo-nfse\`), Rust (\`cargo add corvo-nfse\`), Java (\`tech.corvo:corvo-nfse\`), Elixir (\`{:corvo_nfse, "~> 0.1.1"}\`) and .NET (\`dotnet add package Corvo.Nfse\`). Each reads \`CORVO_API_KEY\`.
- Open source: the API, the worker and the dashboard are public under AGPL-3.0 at https://github.com/corvo-technology/corvo-nfse, and can be self-hosted with Docker Compose (see SELF_HOSTING.md in the repository).
- Multi-company: one account can hold many issuer companies, each with its own certificate.
- Pricing: the first invoice is free (no plan needed, no credit card) and the sandbox is always free. Plans Solo, Equipe, Empresa and Escala (monthly, or annual with 30% off) and single invoices at R$ 0,99 are public at \`GET https://api.corvo.tech/v1/plans\`. There is no overage billing.`;

const PT_INTRO = `# Corvo

> ${SITE_COPY.pt.tagline}

A Corvo cadastra empresas emissoras, guarda os certificados A1, calcula os tributos antes de emitir, emite a NFS-e de forma assíncrona, acompanha cada mudança de status e entrega XML e PDF por link, webhook ou e-mail. A Corvo cobre NFS-e (serviços). A NF-e (mercadorias, modelo 55) existe só em teste (homologação), para empresas do Simples Nacional em SP e nos estados da SVRS, nas contas em que foi liberada; usa as mesmas rotas \`/v1/invoices\` com \`type: "nfe"\` (veja as páginas de NF-e da documentação) e a Corvo não calcula os impostos dela. A NFC-e (varejo) não é coberta.

## Fatos rápidos

- URL base da API: \`https://api.corvo.tech/v1\`. Autentique com o header \`X-API-Key\`. Chaves \`corvo_test_\` usam o ambiente de teste (sem valor fiscal); chaves \`corvo_live_\` emitem notas reais.
- Servidor MCP (agentes de IA): \`https://api.corvo.tech/mcp\`. Claude Code, Cursor, Codex, VS Code, Windsurf e Claude Desktop conectam com OAuth no navegador; o usuário escolhe o workspace e o ambiente (teste ou produção) na tela de aprovação.
- Roteiro do agente no MCP: \`cnpj_lookup\` → \`company_create\` → \`certificate_upload\` → \`company_fiscal_status\` → \`nfse_issue\` → \`credits_balance\` → \`credits_purchase\` → \`payment_status\` → segue emitindo. O pagamento é sempre concluído pela pessoa (cartão ou Pix).
- MCP \`certificate_upload\` (escopo opcional \`nfse:certificates\`): \`tax_id\`, \`pfx_base64\` (até 50 KB), \`password\`. A senha fica no cofre do agente; a Corvo guarda criptografado e nunca devolve.
- MCP \`credits_purchase\` (escopo opcional \`billing:purchase\`): \`units\` e \`method\` (\`pix\` ou \`card\`); devolve o QR Code e o copia-e-cola do Pix ou o link de pagamento no cartão. Não existe em instalações self-hosted.
- MCP \`payment_status\` (escopo \`billing:purchase\`): \`payment_id\` ou \`session_id\`; devolve pendente, pago (com o novo saldo) ou expirado/cancelado.
- MCP \`nfse_review\` (escopo \`nfse:write\`): \`invoice_id\` e \`action\` (\`retry\` ou \`discard\`) para nota em \`manual_review\`. \`retry\` consulta o portal com o mesmo DPS e nunca emite uma segunda NFS-e; \`discard\` só rejeita se o portal confirmar que o DPS nunca foi registrado (o número é pulado).
- Regimes: só MEI e Simples Nacional.
- A emissão é assíncrona: \`POST /v1/invoices\` responde \`202\` e o resultado chega por \`GET /v1/invoices/:id\` ou por webhook. Envie \`Idempotency-Key\` para repetir com segurança.
- \`POST /v1/invoices/calculate\` mostra os tributos sem emitir.
- Nº do pedido e observações: \`purchaseOrder\` (até 60 caracteres) e \`notes\` (até 2.000) em \`POST /v1/invoices\` saem impressos na nota e não mudam nenhum tributo. Valem também no lote, nas agendas, na planilha (colunas \`pedido\` e \`observacoes\`) e no MCP (\`purchase_order\`, \`notes\`).
- Clientes salvos: depois de uma nota com tomador aceita, a Corvo guarda CPF/CNPJ, nome e e-mail. Na nota seguinte para o mesmo documento basta \`customer.taxId\`: o \`name\` vem do cadastro (o que vem na requisição sempre vale; sem cadastro, o nome sai como \`Consumidor\`). Rotas: \`GET /v1/customers?search=\`, \`GET\`, \`PATCH\` e \`DELETE /v1/customers/:taxId\`. No MCP: \`customer_list\`, \`customer_update\`, \`customer_delete\`.
- Cliente no exterior: envie \`customer.foreign\` (\`taxId\` ou \`noTaxIdReason\`, \`country\` em ISO2 diferente de BR, \`postalCode\`, \`city\`, \`region\`, \`street\`, \`number\`, \`district\`) no lugar de \`customer.taxId\`; \`customer.name\` passa a ser obrigatório. Não declara exportação de serviço: a tributação não muda.
- Substituição: \`POST /v1/invoices/:id/substitute\` com \`description\` (15 a 255 caracteres) emite uma nota que substitui uma \`authorized\`; só mudam \`service.description\`, \`purchaseOrder\` e \`notes\`. A original só passa a \`cancelled\` depois de a substituta ser autorizada. A substituta usa um crédito. No MCP: \`nfse_substitute\`.
- Código aberto: a API, o worker e o painel são públicos sob a AGPL-3.0 em https://github.com/corvo-technology/corvo-nfse e podem ser hospedados por você com Docker Compose (veja SELF_HOSTING.md no repositório).
- SDKs oficiais em nove linguagens; o Java usa a coordenada Maven \`tech.corvo:corvo-nfse\`.
- Preço: a primeira nota é grátis (sem plano e sem cartão) e a homologação é sempre grátis. Planos Solo, Equipe, Empresa e Escala (mensal, ou anual com 30% de desconto) e notas avulsas a R$ 0,99 em \`GET https://api.corvo.tech/v1/plans\`. Não há cobrança de excedente.`;

interface Labels {
  docs: string;
  faq: string;
  optional: string;
  intro: string;
  full: string;
  fullDesc: string;
  other: string;
  otherDesc: string;
  legal: string;
  title: string;
}

const LABELS: Record<SeoLocale, Labels> = {
  en: {
    docs: "Documentation",
    faq: "Frequently asked questions",
    optional: "Optional",
    intro: "API introduction and quickstart",
    full: "Full documentation as one text file",
    fullDesc: "Every documentation page in English, for AI tools.",
    other: "Documentação em português (llms.txt)",
    otherDesc: "The same index in Brazilian Portuguese.",
    legal: "[Privacy notice](https://www.corvo.tech/en/privacy), [Terms of service](https://www.corvo.tech/en/terms) and [Data processing addendum](https://www.corvo.tech/en/dpa).",
    title: "Corvo API documentation",
  },
  pt: {
    docs: "Documentação",
    faq: "Perguntas frequentes",
    optional: "Opcional",
    intro: "Introdução à API e início rápido",
    full: "Documentação completa em um arquivo",
    fullDesc: "Todas as páginas da documentação em português, para ferramentas de IA.",
    other: "English documentation (llms.txt)",
    otherDesc: "O mesmo índice em inglês.",
    legal: "[Aviso de privacidade](https://www.corvo.tech/pt/privacy), [Termos de uso](https://www.corvo.tech/pt/terms) e [Adendo de tratamento de dados](https://www.corvo.tech/pt/dpa).",
    title: "Documentação da API Corvo",
  },
};

export const LLMS_PATHS: Record<SeoLocale, { index: string; full: string }> = {
  en: { index: `${SITE_URL}/llms.txt`, full: `${SITE_URL}/llms-full.txt` },
  pt: { index: `${SITE_URL}/pt/llms.txt`, full: `${SITE_URL}/pt/llms-full.txt` },
};

const allSlugs = () => DOC_GROUPS.flatMap((group) => group.slugs);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** One line per blog post, plus the index. The blog is written in Portuguese for both llms.txt files. */
function blogGuides(locale: SeoLocale): string[] {
  return [
    `- [Blog](${blogUrl()}): ${
      locale === "en" ? "plain-language guides on issuing NFS-e, in Portuguese." : "guias em linguagem simples sobre como emitir NFS-e."
    }`,
    ...POSTS.map((post) => `- [${post.title}](${postUrl(post.slug)}): ${oneLine(post.description)}`),
  ];
}

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
    `- ${labels.legal}`,
  ];
  return [
    locale === "en" ? EN_INTRO : PT_INTRO,
    `## ${labels.docs}\n\n${docs.join("\n")}`,
    `## ${locale === "en" ? "Guides (blog, in Portuguese)" : "Guias (blog)"}\n\n${blogGuides(locale).join("\n")}`,
    `## ${labels.faq}\n\n${faqMarkdown(locale)}`,
    `## ${labels.optional}\n\n${optional.join("\n")}`,
  ].join("\n\n") + "\n";
}

export function buildLlmsFull(locale: SeoLocale): string {
  const tree = getDocsTree(locale)!;
  const body = [
    `# ${LABELS[locale].title}\n\n> ${SITE_COPY[locale].tagline}\n\nBase URL: https://api.corvo.tech/v1 · MCP: https://api.corvo.tech/mcp · Site: ${pageUrl(locale)}`,
    sectionToMarkdown(tree.home, 2),
    `## ${LABELS[locale].faq}\n\n${faqMarkdown(locale)}`,
    ...allSlugs().map((slug) => `${sectionToMarkdown(tree.pages[slug], 2)}\n\nSource: ${pageUrl(locale, `/docs/${slug}`)}`),
    ...POSTS.map((post) => postToMarkdown(post, postUrl(post.slug))),
  ].join("\n\n---\n\n");
  return `${body}\n`;
}

export function markdownResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
