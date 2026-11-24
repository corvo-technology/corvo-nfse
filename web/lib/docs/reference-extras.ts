import type { DocBlock, DocsLocale, EndpointBlock, ParamRow } from "./types";

/**
 * Reference blocks for the public routes that have no hand-written entry in the
 * content trees. Both languages come from one builder so they cannot drift apart.
 * The shapes follow the public contract (docs/openapi/openapi.json, also served at
 * https://corvo.tech/openapi.json): when a field changes there, change it here.
 */
const FULL = ["full_access"];
const READ = ["full_access", "invoices_view", "invoices_read_write"];
const WRITE = ["full_access", "invoices_issue", "invoices_read_write"];

const COMPANY = "0b7a5a3e-3c33-4d5e-9a3b-6a3d2f6b9b10";
const PROFILE = "6d1f6f3a-4e0c-4f5e-8f55-0a8f4f0e7a21";
const SERVICE = "9c2c9a60-7d2e-4a5f-b0a6-2d7d57b7a3c4";
const INVOICE = "5f9e0a4a-2f27-4c0c-8a48-6a2a0b8a1d33";

type T = (en: string, pt: string) => string;

interface Spec {
  method: EndpointBlock["method"];
  path: string;
  scopes: string[];
  success: string;
  summary: string;
  /** What is sent: query string, JSON body or nothing. */
  query?: string;
  body?: Record<string, unknown>;
  params?: { title?: string; rows: ParamRow[] };
  label: string;
  json: string;
  notes?: string[];
}

function endpoint(s: Spec): EndpointBlock {
  const url = `$BASE_URL${s.path.replace("/v1", "")}${s.query ?? ""}`;
  const key = `-H "X-API-Key: $CORVO_API_KEY"`;
  const hasBody = s.body !== undefined;
  const curl = [
    `curl ${s.method === "GET" ? "" : `-X ${s.method} `}"${url}"`.replace(
      "curl  ",
      "curl ",
    ),
    key,
    ...(hasBody
      ? [
          `-H "Content-Type: application/json"`,
          `-d '${JSON.stringify(s.body)}'`,
        ]
      : []),
  ].join(" \\\n  ");
  const nodePath = s.path.replace("/v1", "") + (s.query ?? "");
  const node = `const res = await fetch(BASE_URL + "${nodePath}", {${s.method === "GET" ? "" : `\n  method: "${s.method}",`}
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,${hasBody ? `\n    "Content-Type": "application/json",` : ""}
  },${hasBody ? `\n  body: JSON.stringify(${JSON.stringify(s.body)}),` : ""}
});
const body = await res.json();`;
  return {
    kind: "endpoint",
    method: s.method,
    path: s.path,
    scopes: s.scopes,
    success: s.success,
    summary: s.summary,
    ...(s.params ? { params: s.params } : {}),
    examples: { curl, node },
    response: { label: s.label, json: s.json },
    ...(s.notes
      ? {
          notes: s.notes.map((body) => ({
            kind: "callout" as const,
            tone: "warn" as const,
            body,
          })),
        }
      : {}),
  };
}

const row = (
  name: string,
  type: string,
  required: boolean,
  description: string,
): ParamRow => ({ name, type, required, description });

const fiscalProfile = (extra = "") => `{
  "id": "${PROFILE}",
  "companyId": "${COMPANY}",
  "taxRegime": "SIMPLES_NACIONAL",
  "simpleNational": true,
  "specialTaxRegime": null,
  "ibsCbsRegularOption": false,
  "ibsCbsRegularFrom": null,
  "simplesIssRate": "2.00",
  "validFrom": "2026-01-01",
  "validUntil": null,
  "source": "api",
  "reviewStatus": "${extra || "approved"}",
  "reviewedBy": null,
  "reviewedAt": null,
  "createdAt": "2026-11-24T12:00:00.000Z"
}`;

const serviceTaxProfile = (reviewStatus = "unreviewed") => `{
  "id": "${SERVICE}",
  "companyId": "${COMPANY}",
  "name": "Consultoria em TI",
  "serviceCode": "010101",
  "municipalServiceCode": null,
  "nbsCode": "115022000",
  "cst": null,
  "classCode": null,
  "operationIndicator": null,
  "operationNature": "SERVICE",
  "regimeApplicability": ["SIMPLES_NACIONAL"],
  "incidenceMunicipalityCode": null,
  "issTaxation": "NORMAL",
  "issRate": "2.00",
  "issWithholdingDefault": false,
  "withholdingPolicy": "NONE_CONFIRMED",
  "withholdingRates": {},
  "effectiveFrom": "2026-01-01",
  "effectiveUntil": null,
  "classificationSource": "manual",
  "reviewStatus": "${reviewStatus}",
  "catalogVersion": null,
  "createdAt": "2026-11-24T12:00:00.000Z"
}`;

const indent = (json: string, spaces = 2) =>
  json.replace(/^/gm, " ".repeat(spaces));
const wrap = (json: string) => `{\n  "data": ${indent(json).trimStart()}\n}`;

/** Company registry, DPS numbering, fiscal profile, service tax profiles and the accountant package. */
export function companyToolsBlocks(locale: DocsLocale): DocBlock[] {
  const t: T = (en, pt) => (locale === "pt" ? pt : en);
  return [
    {
      kind: "heading",
      level: 2,
      body: t("Look up a CNPJ", "Consultar um CNPJ"),
    },
    endpoint({
      method: "GET",
      path: "/v1/cnpj/:cnpj",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "Public registry data of a CNPJ (names, address, Simples Nacional, MEI, situation), to pre-fill a company or a customer form. Send the CNPJ with or without punctuation. `400` `CNPJ_INVALID` for a malformed CNPJ; `404` `CNPJ_LOOKUP_UNAVAILABLE` when the registry has no answer right now. Needs `nfse.companies.manage` or `nfse.invoices.issue`; 20 requests per minute.",
        "Dados públicos de um CNPJ (nomes, endereço, Simples Nacional, MEI, situação), para preencher o cadastro de uma empresa ou de um cliente. Envie o CNPJ com ou sem pontuação. `400` `CNPJ_INVALID` para um CNPJ malformado; `404` `CNPJ_LOOKUP_UNAVAILABLE` quando a Receita não responde agora. Exige `nfse.companies.manage` ou `nfse.invoices.issue`; 20 requisições por minuto.",
      ),
      params: {
        title: "Path",
        rows: [
          row(
            "cnpj",
            "string",
            true,
            t(
              "14 digits, punctuation optional.",
              "14 dígitos, pontuação opcional.",
            ),
          ),
        ],
      },
      label: "200 OK",
      json: wrap(`{
  "legalName": "ACME TECNOLOGIA LTDA",
  "tradeName": "Acme",
  "address": { "zip": "01310100", "street": "Avenida Paulista", "number": "1000", "complement": "", "district": "Bela Vista", "city": "São Paulo", "state": "SP" },
  "municipalityCode": "3550308",
  "simples": true,
  "mei": false,
  "active": true,
  "situation": "ATIVA"
}`),
    }),
    { kind: "heading", level: 2, body: t("DPS numbering", "Numeração da DPS") },
    {
      kind: "text",
      body: t(
        "Each invoice takes the next DPS number of the company; the Receita refuses a repeated one (`E0014`, shown as `DPS_NUMBER_ALREADY_USED`). If the company already issued notes elsewhere, move the counter forward before the first invoice.",
        "Cada nota usa o próximo número de DPS da empresa; a Receita recusa um número repetido (`E0014`, exibido como `DPS_NUMBER_ALREADY_USED`). Se a empresa já emitiu notas em outro lugar, avance o contador antes da primeira nota.",
      ),
    },
    endpoint({
      method: "GET",
      path: "/v1/companies/:id/dps-sequence",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "The DPS series and the last number used (`0` when none yet). Needs `nfse.companies.view`.",
        "A série da DPS e o último número usado (`0` quando ainda não há). Exige `nfse.companies.view`.",
      ),
      label: "200 OK",
      json: `{ "data": { "series": "00001", "lastNumber": 120 } }`,
    }),
    endpoint({
      method: "PUT",
      path: "/v1/companies/:id/dps-sequence",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "Continues the numbering from the last number the company issued elsewhere (see it in the last note, PDF or XML). The next invoice uses the following number. It only moves forward: a lower number answers `422` `DPS_NUMBER_BELOW_CURRENT`. Needs `nfse.companies.manage`.",
        "Continua a numeração a partir do último número que a empresa emitiu em outro lugar (veja na última nota, PDF ou XML). A próxima nota usa o número seguinte. Só avança: um número menor responde `422` `DPS_NUMBER_BELOW_CURRENT`. Exige `nfse.companies.manage`.",
      ),
      body: { lastNumber: 120 },
      params: {
        rows: [
          row(
            "lastNumber",
            "integer",
            true,
            t(
              "Last DPS number already used in this series, `0` or more.",
              "Último número de DPS já usado nesta série, `0` ou mais.",
            ),
          ),
        ],
      },
      label: "200 OK",
      json: `{ "data": { "series": "00001", "lastNumber": 120 } }`,
    }),
    { kind: "heading", level: 2, body: t("Fiscal profile", "Perfil fiscal") },
    endpoint({
      method: "GET",
      path: "/v1/companies/:id/fiscal-profile",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "The fiscal profile history of the company (regime, Simples Nacional, special regime, IBS/CBS option) by validity period. Needs `nfse.companies.view`.",
        "O histórico do perfil fiscal da empresa (regime, Simples Nacional, regime especial, opção IBS/CBS) por período de vigência. Exige `nfse.companies.view`.",
      ),
      label: "200 OK",
      json: `{ "data": [\n${indent(fiscalProfile())}\n] }`,
    }),
    endpoint({
      method: "PUT",
      path: "/v1/companies/:id/fiscal-profile",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "Opens a new validity period of the fiscal profile, from `validFrom`. Sending a state equal to the open one changes nothing, so the call is safe to repeat. Needs `nfse.companies.manage`.",
        "Abre um novo período de vigência do perfil fiscal, a partir de `validFrom`. Enviar um estado igual ao aberto não muda nada, então a chamada é segura para repetir. Exige `nfse.companies.manage`.",
      ),
      body: {
        taxRegime: "SIMPLES_NACIONAL",
        simpleNational: true,
        validFrom: "2026-01-01",
      },
      params: {
        rows: [
          row(
            "taxRegime",
            "string",
            true,
            t(
              "`MEI` or `SIMPLES_NACIONAL`. Any other regime answers `422` `ERROR_TAX_REGIME_NOT_SUPPORTED`.",
              "`MEI` ou `SIMPLES_NACIONAL`. Qualquer outro regime responde `422` `ERROR_TAX_REGIME_NOT_SUPPORTED`.",
            ),
          ),
          row(
            "validFrom",
            "date",
            false,
            t(
              "First day of the period (default: today).",
              "Primeiro dia do período (padrão: hoje).",
            ),
          ),
          row(
            "simpleNational",
            "boolean",
            false,
            t(
              "Opted for the Simples Nacional.",
              "Optante pelo Simples Nacional.",
            ),
          ),
          row(
            "specialTaxRegime",
            "string",
            false,
            t(
              "Special regime code, `0` to `6`.",
              "Código do regime especial, de `0` a `6`.",
            ),
          ),
          row(
            "ibsCbsRegularOption",
            "boolean",
            false,
            t(
              "Opted for the regular IBS/CBS regime.",
              "Optou pelo regime regular de IBS/CBS.",
            ),
          ),
          row(
            "ibsCbsRegularFrom",
            "date",
            false,
            t(
              "From when the regular IBS/CBS option holds.",
              "A partir de quando vale a opção regular de IBS/CBS.",
            ),
          ),
        ],
      },
      label: "200 OK",
      json: wrap(fiscalProfile()),
    }),
    endpoint({
      method: "POST",
      path: "/v1/companies/:id/fiscal-profile/:profileId/approve",
      scopes: FULL,
      success: "201 Created",
      summary: t(
        "Marks a fiscal profile as reviewed and approved. Needs `nfse.companies.manage`.",
        "Marca um perfil fiscal como revisado e aprovado. Exige `nfse.companies.manage`.",
      ),
      label: "201 Created",
      json: wrap(fiscalProfile()),
    }),
    {
      kind: "heading",
      level: 2,
      body: t("Service tax profiles", "Perfis tributários de serviço"),
    },
    {
      kind: "text",
      body: t(
        "The catalog of the services a company sells, with their tax classification. A profile starts `unreviewed`; approve it before it is used to withhold taxes. `effectiveFrom` is inclusive and `effectiveUntil` exclusive.",
        "O catálogo dos serviços que a empresa vende, com a classificação tributária de cada um. Um perfil começa `unreviewed`; aprove antes de usá-lo para reter tributos. `effectiveFrom` é inclusivo e `effectiveUntil` é exclusivo.",
      ),
    },
    endpoint({
      method: "GET",
      path: "/v1/companies/:id/service-tax-profiles",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "The profiles effective on `date` (default: today in America/Sao_Paulo). Needs `nfse.companies.view`.",
        "Os perfis vigentes em `date` (padrão: hoje em America/Sao_Paulo). Exige `nfse.companies.view`.",
      ),
      query: "?date=2026-11-24",
      params: {
        title: "Query",
        rows: [
          row(
            "date",
            "date",
            false,
            t("Day to evaluate, `YYYY-MM-DD`.", "Dia a avaliar, `YYYY-MM-DD`."),
          ),
        ],
      },
      label: "200 OK",
      json: `{ "data": [\n${indent(serviceTaxProfile())}\n] }`,
    }),
    endpoint({
      method: "POST",
      path: "/v1/companies/:id/service-tax-profiles",
      scopes: FULL,
      success: "201 Created",
      summary: t(
        "Adds a service to the catalog. Besides `name`, `serviceCode` and `effectiveFrom` you can send the classification (`nbsCode`, `cst`, `classCode`, `operationIndicator`), ISS (`issTaxation`, `issRate`, `issWithholdingDefault`) and withholdings (`withholdingPolicy` `UNKNOWN`, `NONE_CONFIRMED` or `CONFIGURED`, with `withholdingRates` in percent). Needs `nfse.companies.manage`.",
        "Adiciona um serviço ao catálogo. Além de `name`, `serviceCode` e `effectiveFrom`, você pode enviar a classificação (`nbsCode`, `cst`, `classCode`, `operationIndicator`), o ISS (`issTaxation`, `issRate`, `issWithholdingDefault`) e as retenções (`withholdingPolicy` `UNKNOWN`, `NONE_CONFIRMED` ou `CONFIGURED`, com `withholdingRates` em percentual). Exige `nfse.companies.manage`.",
      ),
      body: {
        name: "Consultoria em TI",
        serviceCode: "010101",
        nbsCode: "115022000",
        effectiveFrom: "2026-01-01",
        withholdingPolicy: "NONE_CONFIRMED",
      },
      label: "201 Created",
      json: wrap(serviceTaxProfile()),
    }),
    endpoint({
      method: "PATCH",
      path: "/v1/companies/:id/service-tax-profiles/:serviceId",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "Changes the listed fields of a profile; omitted fields stay. Needs `nfse.companies.manage`.",
        "Altera os campos enviados de um perfil; os omitidos ficam como estão. Exige `nfse.companies.manage`.",
      ),
      body: { issRate: "2.50" },
      label: "200 OK",
      json: wrap(serviceTaxProfile()),
    }),
    endpoint({
      method: "POST",
      path: "/v1/companies/:id/service-tax-profiles/:serviceId/approve",
      scopes: FULL,
      success: "201 Created",
      summary: t(
        "Approves the saved classification of the service for this company. Needs `nfse.companies.manage`.",
        "Aprova a classificação salva do serviço para esta empresa. Exige `nfse.companies.manage`.",
      ),
      label: "201 Created",
      json: wrap(serviceTaxProfile("approved")),
    }),
    endpoint({
      method: "DELETE",
      path: "/v1/companies/:id/service-tax-profiles/:serviceId",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "Deletes a profile that has expired and was never approved (`422` otherwise). Needs `nfse.companies.manage`.",
        "Apaga um perfil que já expirou e nunca foi aprovado (`422` nos outros casos). Exige `nfse.companies.manage`.",
      ),
      label: "200 OK",
      json: `{ "data": null }`,
    }),
    {
      kind: "heading",
      level: 2,
      body: t("Accountant package", "Pacote do contador"),
    },
    {
      kind: "text",
      body: t(
        "On the 1st of each month Corvo e-mails the accountant a ZIP with the XML and PDF of the previous month (see `GET /v1/companies/:companyId/invoice-package`). Live companies only.",
        "No dia 1º de cada mês a Corvo envia ao contador, por e-mail, um ZIP com o XML e o PDF do mês anterior (veja `GET /v1/companies/:companyId/invoice-package`). Somente empresas em produção.",
      ),
    },
    endpoint({
      method: "GET",
      path: "/v1/companies/:companyId/accountant-package",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "The accountant e-mail and the last month sent. Needs `nfse.companies.view`.",
        "O e-mail do contador e o último mês enviado. Exige `nfse.companies.view`.",
      ),
      label: "200 OK",
      json: `{ "data": { "email": "contador@example.com", "lastSentMonth": "2026-10" } }`,
    }),
    endpoint({
      method: "PUT",
      path: "/v1/companies/:companyId/accountant-package",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "Sets the accountant e-mail; `null` or blank turns the monthly send off. A new address gets a short hello (`testEmailSent`) so a wrong recipient is noticed. Needs `nfse.companies.manage`.",
        "Define o e-mail do contador; `null` ou vazio desliga o envio mensal. Um endereço novo recebe uma mensagem curta (`testEmailSent`) para que um destinatário errado seja notado. Exige `nfse.companies.manage`.",
      ),
      body: { accountantEmail: "contador@example.com" },
      params: {
        rows: [
          row(
            "accountantEmail",
            "string | null",
            true,
            t(
              "A valid e-mail, or `null` to turn it off.",
              "Um e-mail válido, ou `null` para desligar.",
            ),
          ),
        ],
      },
      label: "200 OK",
      json: `{ "data": { "email": "contador@example.com", "lastSentMonth": "2026-10", "testEmailSent": true } }`,
    }),
    endpoint({
      method: "POST",
      path: "/v1/companies/:companyId/accountant-package/send",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "Sends the package of a month now, even if it was already sent. `status` is `sent` (queued for e-mail, not proof of delivery) or `skipped-test`, `skipped-no-email`, `skipped-empty`, `skipped-too-large`, with nothing sent. 10 per hour. Needs `nfse.companies.manage`.",
        "Envia agora o pacote de um mês, mesmo que já tenha sido enviado. `status` é `sent` (na fila do e-mail, não é prova de entrega) ou `skipped-test`, `skipped-no-email`, `skipped-empty`, `skipped-too-large`, sem envio. 10 por hora. Exige `nfse.companies.manage`.",
      ),
      body: { month: "2026-10" },
      params: {
        rows: [
          row(
            "month",
            "string",
            true,
            t("Competence month, `YYYY-MM`.", "Mês de competência, `YYYY-MM`."),
          ),
        ],
      },
      label: "200 OK",
      json: `{ "data": { "status": "sent" } }`,
    }),
    endpoint({
      method: "GET",
      path: "/v1/companies/:companyId/accountant-package/sends",
      scopes: FULL,
      success: "200 OK",
      summary: t(
        "The last 12 attempts to send the package. Needs `nfse.companies.view`.",
        "As últimas 12 tentativas de envio do pacote. Exige `nfse.companies.view`.",
      ),
      label: "200 OK",
      json: `{ "data": [ {
  "id": "2a3c6f1e-8d25-4c19-9e0d-7b3b1d1c4c55",
  "month": "2026-10",
  "recipient": "contador@example.com",
  "invoiceCount": 42,
  "totalCents": 12750000,
  "status": "sent",
  "trigger": "scheduled",
  "createdAt": "2026-11-01T12:00:00.000Z"
} ] }`,
    }),
  ];
}

/** Overview, manual review, portal status, package summary and favorite services. */
export function invoiceToolsBlocks(locale: DocsLocale): DocBlock[] {
  const t: T = (en, pt) => (locale === "pt" ? pt : en);
  return [
    {
      kind: "heading",
      level: 2,
      body: t("Overview and status", "Resumo e situação"),
    },
    endpoint({
      method: "GET",
      path: "/v1/invoices/overview",
      scopes: READ,
      success: "200 OK",
      summary: t(
        "Counts for the last 7 or 30 calendar days (America/Sao_Paulo, today included), the authorizations per day and the 5 most recent invoices. Needs `nfse.invoices.view`.",
        "Contagens dos últimos 7 ou 30 dias corridos (America/Sao_Paulo, hoje incluído), as autorizações por dia e as 5 notas mais recentes. Exige `nfse.invoices.view`.",
      ),
      query: "?period=30d",
      params: {
        title: "Query",
        rows: [
          row(
            "period",
            "string",
            false,
            t("`7d` (default) or `30d`.", "`7d` (padrão) ou `30d`."),
          ),
        ],
      },
      label: "200 OK",
      json: `{
  "data": {
    "period": "30d",
    "from": "2026-10-26",
    "to": "2026-11-24",
    "timezone": "America/Sao_Paulo",
    "counts": { "authorized": 118, "rejected": 2, "processing": 1 },
    "dailyActivity": [ { "date": "2026-11-24", "count": 6 } ],
    "recentInvoices": [ /* up to 5 invoices, like GET /v1/invoices/:id */ ]
  }
}`,
    }),
    endpoint({
      method: "GET",
      path: "/v1/fiscal-portal/status",
      scopes: READ,
      success: "200 OK",
      summary: t(
        "Whether the national NFS-e portal is answering for the environment of the key. While `available` is `false`, invoices wait in the queue and are sent once it answers again. Needs `nfse.invoices.view`.",
        "Se o portal nacional da NFS-e está respondendo para o ambiente da chave. Enquanto `available` for `false`, as notas esperam na fila e são enviadas quando ele voltar. Exige `nfse.invoices.view`.",
      ),
      label: "200 OK",
      json: `{ "data": { "environment": "live", "available": true, "since": null, "retryAt": null } }`,
    }),
    endpoint({
      method: "POST",
      path: "/v1/invoices/review",
      scopes: WRITE,
      success: "202 Accepted",
      summary: t(
        "Resolves up to 100 invoices in `manual_review`. `retry` sends the invoice again with the same DPS: the portal is asked about that DPS first, so it never issues a second NFS-e. `discard` rejects the invoice (and refunds its credit) only after the portal confirms the DPS was never registered; if the NFS-e exists, the invoice becomes `authorized`. Invoices not in `manual_review` are skipped. Follow the result by webhook. Needs `nfse.invoices.issue`.",
        "Resolve até 100 notas em `manual_review`. `retry` reenvia a nota com a mesma DPS: o portal é consultado primeiro sobre essa DPS, então nunca emite uma segunda NFS-e. `discard` rejeita a nota (e devolve o crédito) só depois que o portal confirma que a DPS nunca foi registrada; se a NFS-e existir, a nota passa a `authorized`. Notas fora de `manual_review` são ignoradas. Acompanhe o resultado por webhook. Exige `nfse.invoices.issue`.",
      ),
      body: { action: "retry", invoiceIds: [INVOICE] },
      params: {
        rows: [
          row("action", "string", true, "`retry` | `discard`"),
          row(
            "invoiceIds",
            "uuid[]",
            true,
            t("1 to 100 invoice ids.", "De 1 a 100 ids de nota."),
          ),
        ],
      },
      label: "202 Accepted",
      json: `{ "data": { "results": [ { "id": "${INVOICE}", "outcome": "accepted" } ] } }`,
      notes: [
        t(
          'A skipped invoice answers `{ "outcome": "skipped", "reason": "not_found" | "not_in_manual_review" | "changed" }`.',
          'Uma nota ignorada responde `{ "outcome": "skipped", "reason": "not_found" | "not_in_manual_review" | "changed" }`.',
        ),
      ],
    }),
    endpoint({
      method: "GET",
      path: "/v1/companies/:companyId/invoice-package/summary",
      scopes: READ,
      success: "200 OK",
      summary: t(
        "How many authorized and cancelled invoices the competence month has, and their total, without building the ZIP. Use it to check the month fits the limit (`limit`, 500) before `GET /v1/companies/:companyId/invoice-package`. Needs `nfse.invoices.view`.",
        "Quantas notas autorizadas e canceladas o mês de competência tem, e o total, sem montar o ZIP. Use para conferir se o mês cabe no limite (`limit`, 500) antes de `GET /v1/companies/:companyId/invoice-package`. Exige `nfse.invoices.view`.",
      ),
      query: "?month=2026-10",
      params: {
        title: "Query",
        rows: [
          row(
            "month",
            "string",
            true,
            t("Competence month, `YYYY-MM`.", "Mês de competência, `YYYY-MM`."),
          ),
        ],
      },
      label: "200 OK",
      json: `{ "data": { "month": "2026-10", "count": 42, "total": 127500, "limit": 500, "companyName": "Acme", "companyTaxId": "12345678000195" } }`,
    }),
    {
      kind: "heading",
      level: 2,
      body: t("Favorite services", "Serviços favoritos"),
    },
    {
      kind: "text",
      body: t(
        "Services a company issues often. Save them once and reuse the description, code and amount when issuing.",
        "Serviços que a empresa emite com frequência. Salve uma vez e reaproveite a descrição, o código e o valor ao emitir.",
      ),
    },
    endpoint({
      method: "GET",
      path: "/v1/companies/:companyId/service-favorites",
      scopes: READ,
      success: "200 OK",
      summary: t(
        "The favorite services of the company. Needs `nfse.invoices.view`.",
        "Os serviços favoritos da empresa. Exige `nfse.invoices.view`.",
      ),
      label: "200 OK",
      json: `{ "data": [ {
  "id": "${SERVICE}",
  "companyId": "${COMPANY}",
  "label": "Consultoria mensal",
  "description": "Consultoria em tecnologia da informação",
  "serviceCode": "010101",
  "amountCents": 150000,
  "municipalityCode": null,
  "createdAt": "2026-11-24T12:00:00.000Z"
} ] }`,
    }),
    endpoint({
      method: "POST",
      path: "/v1/companies/:companyId/service-favorites",
      scopes: WRITE,
      success: "201 Created",
      summary: t(
        "Saves a favorite service. Needs `nfse.invoices.issue`.",
        "Salva um serviço favorito. Exige `nfse.invoices.issue`.",
      ),
      body: {
        label: "Consultoria mensal",
        description: "Consultoria em tecnologia da informação",
        serviceCode: "010101",
        amountCents: 150000,
      },
      params: {
        rows: [
          row(
            "label",
            "string",
            true,
            t("Name shown in the list.", "Nome exibido na lista."),
          ),
          row(
            "description",
            "string",
            true,
            t(
              "Service description printed on the invoice.",
              "Descrição do serviço impressa na nota.",
            ),
          ),
          row(
            "serviceCode",
            "string",
            true,
            t("Service code (LC 116).", "Código do serviço (LC 116)."),
          ),
          row(
            "amountCents",
            "integer",
            false,
            t("Default amount in cents.", "Valor padrão em centavos."),
          ),
          row(
            "municipalityCode",
            "string",
            false,
            t("7-digit IBGE code.", "Código IBGE de 7 dígitos."),
          ),
        ],
      },
      label: "201 Created",
      json: `{ "data": {
  "id": "${SERVICE}",
  "companyId": "${COMPANY}",
  "label": "Consultoria mensal",
  "description": "Consultoria em tecnologia da informação",
  "serviceCode": "010101",
  "amountCents": 150000,
  "municipalityCode": null,
  "createdAt": "2026-11-24T12:00:00.000Z"
} }`,
    }),
    endpoint({
      method: "DELETE",
      path: "/v1/companies/:companyId/service-favorites/:favoriteId",
      scopes: WRITE,
      success: "200 OK",
      summary: t(
        "Removes a favorite service. Issued invoices are not changed. Needs `nfse.invoices.issue`.",
        "Remove um serviço favorito. As notas já emitidas não mudam. Exige `nfse.invoices.issue`.",
      ),
      label: "200 OK",
      json: `{ "data": { "deleted": true } }`,
    }),
  ];
}

/** `GET /v1/credits/purchase/preview`: the old POST route only answered 410. */
export function creditsPreviewBlock(locale: DocsLocale): EndpointBlock {
  const t: T = (en, pt) => (locale === "pt" ? pt : en);
  return endpoint({
    method: "GET",
    path: "/v1/credits/purchase/preview",
    scopes: FULL,
    success: "200 OK",
    summary: t(
      'Prices a one-off purchase of single notes without buying: R$ 0,99 each, from 3, whole numbers. The purchase itself is done in the dashboard (`POST /v1/billing/checkout` with `kind: "avulso"`). Needs `credits.view`.',
      'Calcula o preço de uma compra de notas avulsas, sem comprar: R$ 0,99 cada, a partir de 3, números inteiros. A compra em si é feita no painel (`POST /v1/billing/checkout` com `kind: "avulso"`). Exige `credits.view`.',
    ),
    query: "?units=10",
    params: {
      title: "Query",
      rows: [
        row(
          "units",
          "integer",
          true,
          t(
            "Number of notes, at least 3.",
            "Quantidade de notas, no mínimo 3.",
          ),
        ),
      ],
    },
    label: "200 OK",
    json: `{ "data": { "units": 10, "unitPriceCents": 99, "totalCents": 990 } }`,
    notes: [
      t(
        "Fewer than 3 notes, or a fractional number, answers `400` `CHECKOUT_INVALID`. There is no overage billing: when the plan notes end, buy single notes or change plan.",
        "Menos de 3 notas, ou um número fracionado, responde `400` `CHECKOUT_INVALID`. Não há cobrança de excedente: quando as notas do plano acabarem, compre notas avulsas ou mude de plano.",
      ),
    ],
  });
}
