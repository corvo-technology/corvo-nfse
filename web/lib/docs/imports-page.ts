import type { DocBlock, DocSection, DocsLocale, EndpointBlock } from "./types";

/** Both languages come from one builder, so the pages can never drift apart in structure. */
const loc = <T>(locale: DocsLocale, en: T, pt: T): T => (locale === "pt" ? pt : en);

const READ_SCOPES = ["full_access", "invoices_view", "invoices_read_write"];
const WRITE_SCOPES = ["full_access", "invoices_issue", "invoices_read_write"];

const IMPORT_JSON = `{
  "data": {
    "id": "576905ae-1707-4848-9ed6-5a6e51800b74",
    "status": "ready",
    "file_name": "notas-novembro.csv",
    "company_id": null,
    "error_code": null,
    "rows_expected": 300,
    "unknown_columns": [],
    "emit_started_at": null,
    "emit_finished_at": null,
    "created_at": "2026-11-07T13:05:21.000Z",
    "counters": {
      "total": 300,
      "valid": 297,
      "invalid": 3,
      "accepted": 0,
      "authorized": 0,
      "awaiting_credits": 0,
      "valid_amount": 718602.19,
      "awaiting_amount": 0,
      "failed": 3,
      "pending": 297,
      "authorized_amount": 0,
      "pending_amount": 718602.19,
      "failed_amount": 0
    }
  }
}`;

const ROW_JSON = `{
  "line": 42,
  "data": {
    "amount": "abc",
    "competenceDate": "2026-11-07",
    "companyTaxId": "61469487000140",
    "customer": { "name": "Maria da Silva", "taxId": "52998224725" },
    "service": { "description": "Consultoria mensal" }
  },
  "status": "invalid",
  "error_code": "ERROR_VALIDATION",
  "error_message": "Request validation failed",
  "invoice_id": null
}`;

function endpoints(locale: DocsLocale): EndpointBlock[] {
  const t = <T>(en: T, pt: T) => loc(locale, en, pt);
  return [
    {
      kind: "endpoint",
      method: "POST",
      path: "/v1/imports",
      scopes: WRITE_SCOPES,
      success: "202 Accepted",
      summary: t(
        "Uploads a spreadsheet (`.csv` or `.xlsx`, up to 2,000 rows and 10 MB) as `multipart/form-data`. Reading is **asynchronous**: the answer is the import to follow, with `status: \"processing\"`. If the very same file was uploaded before for this company and environment, `duplicate_of` carries the earlier import (a warning, not a block).",
        "Envia uma planilha (`.csv` ou `.xlsx`, até 2.000 linhas e 10 MB) como `multipart/form-data`. A leitura é **assíncrona**: a resposta é a importação a acompanhar, com `status: \"processing\"`. Se este mesmo arquivo já foi enviado antes para a empresa e o ambiente, `duplicate_of` traz a importação anterior (um aviso, não um bloqueio).",
      ),
      params: {
        title: t("Form fields", "Campos do formulário"),
        rows: [
          { name: "file", type: "file", required: true, description: t("The `.csv` or `.xlsx` spreadsheet.", "A planilha `.csv` ou `.xlsx`.") },
          { name: "companyId", type: "string (uuid)", required: false, description: t("Company that issues the rows without a CNPJ. A row with another company's CNPJ is rejected, so the wrong company never issues.", "Empresa que emite as linhas sem CNPJ. Uma linha com o CNPJ de outra empresa é recusada, para que a empresa errada nunca emita.") },
        ],
      },
      examples: {
        curl: `curl -X POST "$BASE_URL/imports" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -F "file=@notas-novembro.csv" \\
  -F "companyId=5b0e7c5a-5d0b-4f45-8d6c-3a2a1e9d7f20"`,
        node: `const form = new FormData();
form.append("file", new Blob([csv], { type: "text/csv" }), "notas-novembro.csv");
const res = await fetch(BASE_URL + "/imports", {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
  body: form,
});
const { data } = await res.json(); // data.id, data.status, data.duplicate_of`,
      },
      response: {
        label: t("202 Accepted: the import to follow", "202 Accepted: a importação a acompanhar"),
        json: `{ "data": { "id": "576905ae-1707-4848-9ed6-5a6e51800b74", "status": "processing", "duplicate_of": null } }`,
      },
      notes: [
        { kind: "callout", tone: "warn", body: t("The upload is limited to 10 requests per minute. A file over 10 MB answers `413` with `ERROR_IMPORT_FILE_TOO_LARGE`; another type answers `400` with `ERROR_IMPORT_FILE_INVALID`.", "O envio é limitado a 10 requisições por minuto. Um arquivo acima de 10 MB responde `413` com `ERROR_IMPORT_FILE_TOO_LARGE`; outro tipo de arquivo responde `400` com `ERROR_IMPORT_FILE_INVALID`.") },
      ],
    },
    {
      kind: "endpoint",
      method: "GET",
      path: "/v1/imports",
      scopes: READ_SCOPES,
      success: "200 OK",
      summary: t(
        "Lists the recent imports of the environment, newest first, with their counters (at most 20). Useful to find an import again, for example one waiting for credits.",
        "Lista as importações recentes do ambiente, da mais nova para a mais antiga, com os contadores (no máximo 20). Útil para reencontrar uma importação, por exemplo uma que aguarda créditos.",
      ),
      params: { title: "Query", rows: [{ name: "limit", type: "integer", required: false, description: t("1 to 20, default `10`.", "De 1 a 20, padrão `10`.") }] },
      examples: {
        curl: `curl "$BASE_URL/imports?limit=10" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
        node: `const res = await fetch(BASE_URL + "/imports?limit=10", {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data } = await res.json();`,
      },
      response: { label: t("200 OK: a list of imports", "200 OK: lista de importações"), json: `{ "data": [ /* imports, like GET /v1/imports/:id */ ] }` },
    },
    {
      kind: "endpoint",
      method: "GET",
      path: "/v1/imports/:id",
      scopes: READ_SCOPES,
      success: "200 OK",
      summary: t(
        "Status and counters of one import. Poll it while `status` is `processing` or `emitting`. While reading, `rows_expected` is how many rows the file has and `counters.total` how many are already checked.",
        "Status e contadores de uma importação. Consulte enquanto o `status` for `processing` ou `emitting`. Durante a leitura, `rows_expected` é quantas linhas o arquivo tem e `counters.total` quantas já foram conferidas.",
      ),
      examples: {
        curl: `curl "$BASE_URL/imports/576905ae-1707-4848-9ed6-5a6e51800b74" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
        node: `const res = await fetch(BASE_URL + "/imports/" + id, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data } = await res.json(); // data.status, data.counters`,
      },
      response: { label: t("200 OK: the import with its counters", "200 OK: a importação com os contadores"), json: IMPORT_JSON },
    },
    {
      kind: "endpoint",
      method: "GET",
      path: "/v1/imports/:id/rows",
      scopes: READ_SCOPES,
      success: "200 OK",
      summary: t(
        "The rows of an import, **one page at a time** (never the whole sheet). Filter by `status` to list only the rows with problems (`invalid`) and read the reason in `error_code` and `error_message`.",
        "As linhas de uma importação, **uma página por vez** (nunca a planilha inteira). Filtre por `status` para listar só as linhas com problema (`invalid`) e ler o motivo em `error_code` e `error_message`.",
      ),
      params: {
        title: "Query",
        rows: [
          { name: "status", type: "string", required: false, description: t("`valid`, `invalid`, `queued`, `accepted` or `rejected`.", "`valid`, `invalid`, `queued`, `accepted` ou `rejected`.") },
          { name: "limit", type: "integer", required: false, description: t("1 to 200, default `50`; more answers `400`.", "De 1 a 200, padrão `50`; acima disso responde `400`.") },
          { name: "cursor", type: "string", required: false, description: t("`nextCursor` of the previous page.", "`nextCursor` da página anterior.") },
        ],
      },
      examples: {
        curl: `curl "$BASE_URL/imports/576905ae-1707-4848-9ed6-5a6e51800b74/rows?status=invalid&limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
        node: `const res = await fetch(BASE_URL + "/imports/" + id + "/rows?status=invalid&limit=50", {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data, pagination } = await res.json();`,
      },
      response: { label: t("200 OK: a page of rows", "200 OK: uma página de linhas"), json: `{ "data": [\n${ROW_JSON.replace(/^/gm, "  ")}\n], "pagination": { "limit": 50, "hasMore": false, "nextCursor": null } }` },
    },
    {
      kind: "endpoint",
      method: "PATCH",
      path: "/v1/imports/:id/rows/:line",
      scopes: WRITE_SCOPES,
      success: "200 OK",
      summary: t(
        "Corrects one row and checks it again, only while the import is `ready`. Send the changed fields in `item`. `customer` and `service` are merged field by field, so editing the e-mail keeps the name. `companyId` and `companyTaxId` cannot be changed. The answer is the row, `valid` or still `invalid` with the reason. A row already queued for issuing answers `409` with `ERROR_IMPORT_STATE`.",
        "Corrige uma linha e a confere de novo, somente enquanto a importação estiver `ready`. Envie os campos alterados em `item`. `customer` e `service` são mesclados campo a campo, então alterar o e-mail mantém o nome. `companyId` e `companyTaxId` não podem ser alterados. A resposta é a linha, `valid` ou ainda `invalid` com o motivo. Uma linha que já entrou na fila de emissão responde `409` com `ERROR_IMPORT_STATE`.",
      ),
      params: { rows: [{ name: "item", type: "object", required: true, description: t("Invoice fields to change: `amount`, `competenceDate`, `customer { name, taxId, email }`, `service { description, code }`.", "Campos da nota a alterar: `amount`, `competenceDate`, `customer { name, taxId, email }`, `service { description, code }`.") }] },
      examples: {
        curl: `curl -X PATCH "$BASE_URL/imports/576905ae-1707-4848-9ed6-5a6e51800b74/rows/42" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{ "item": { "amount": 1500.5 } }'`,
        node: `const res = await fetch(BASE_URL + "/imports/" + id + "/rows/42", {
  method: "PATCH",
  headers: { "X-API-Key": process.env.CORVO_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ item: { amount: 1500.5 } }),
});`,
      },
      response: { label: t("200 OK: the row, checked again", "200 OK: a linha, conferida de novo"), json: `{ "data": ${ROW_JSON.replace('"amount": "abc"', '"amount": 1500.5').replace('"status": "invalid"', '"status": "valid"').replace('"error_code": "ERROR_VALIDATION"', '"error_code": null').replace('"error_message": "Request validation failed"', '"error_message": null')} }` },
    },
    {
      kind: "endpoint",
      method: "POST",
      path: "/v1/imports/:id/emit",
      scopes: WRITE_SCOPES,
      success: "202 Accepted",
      summary: t(
        "Issues every valid row, in chunks of 50, with one idempotency key per line: calling it twice never issues twice. If the plan limit or the credits run out, the remaining rows are left as `awaiting_credits` (not errors). After topping up, **call it again**: only those rows are sent.",
        "Emite todas as linhas válidas, em pedaços de 50, com uma chave de idempotência por linha: chamar duas vezes nunca emite duas vezes. Se o limite do plano ou os créditos acabarem, as linhas restantes ficam como `awaiting_credits` (não são erro). Depois de recarregar, **chame de novo**: só essas linhas são enviadas.",
      ),
      examples: {
        curl: `curl -X POST "$BASE_URL/imports/576905ae-1707-4848-9ed6-5a6e51800b74/emit" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
        node: `const res = await fetch(BASE_URL + "/imports/" + id + "/emit", {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data } = await res.json(); // data.status === "emitting"`,
      },
      response: { label: t("202 Accepted: the import, now emitting", "202 Accepted: a importação, agora emitindo"), json: IMPORT_JSON.replace('"status": "ready"', '"status": "emitting"') },
    },
  ];
}

export function importsPage(locale: DocsLocale): DocSection {
  const t = <T>(en: T, pt: T) => loc(locale, en, pt);
  const blocks: DocBlock[] = [
    { kind: "text", body: t(
      "Issue hundreds of invoices from one spreadsheet. You upload a `.csv` or `.xlsx`, Corvo reads and checks every row in the background, you review the problems if you want, and then you issue everything. The same flow is available in the dashboard (Invoices, Import spreadsheet) and to assistants through MCP.",
      "Emita centenas de notas a partir de uma planilha. Você envia um `.csv` ou `.xlsx`, a Corvo lê e confere cada linha em segundo plano, você revê os problemas se quiser, e então emite tudo. O mesmo fluxo existe no painel (Notas, Importar planilha) e para assistentes por MCP.",
    ) },
    { kind: "heading", level: 2, body: t("How it works", "Como funciona") },
    { kind: "list", items: [
      t("`POST /v1/imports` uploads the file and answers right away with the import id.", "`POST /v1/imports` envia o arquivo e responde na hora com o id da importação."),
      t("Poll `GET /v1/imports/:id` until `status` is `ready`. Each row is checked on its own: a bad row never stops the others.", "Consulte `GET /v1/imports/:id` até o `status` ser `ready`. Cada linha é conferida sozinha: uma linha ruim nunca impede as outras."),
      t("Optional review: `GET /v1/imports/:id/rows?status=invalid` shows the problems, `PATCH /v1/imports/:id/rows/:line` fixes one, `GET /v1/imports/:id/errors.csv` downloads only the errors.", "Revisão opcional: `GET /v1/imports/:id/rows?status=invalid` mostra os problemas, `PATCH /v1/imports/:id/rows/:line` corrige um, `GET /v1/imports/:id/errors.csv` baixa só os erros."),
      t("`POST /v1/imports/:id/emit` issues the valid rows. Follow the counters until `status` is `done`.", "`POST /v1/imports/:id/emit` emite as linhas válidas. Acompanhe os contadores até o `status` ser `done`."),
    ] },
    { kind: "heading", level: 2, body: t("The spreadsheet", "A planilha") },
    { kind: "text", body: t(
      "The first line is the header. Names are matched without caring about case or accents, in Portuguese or English (`valor` or `amount`). CSV may use `;` or `,` and UTF-8, UTF-16 or Windows encodings. Amounts accept `1.234,56`, `1234.56` and `R$ 1.234,56`; dates accept `dd/mm/aaaa` (also `7/11/2026`, `07-11-2026` and `07.11.2026`) and `aaaa-mm-dd`. Columns that match no name below are ignored and listed in `unknown_columns` of the import. Formulas are never run: only the stored value is read.",
      "A primeira linha é o cabeçalho. Os nomes são reconhecidos sem diferenciar maiúsculas e acentos, em português ou inglês (`valor` ou `amount`). O CSV pode usar `;` ou `,` e codificação UTF-8, UTF-16 ou do Windows. Os valores aceitam `1.234,56`, `1234.56` e `R$ 1.234,56`; as datas aceitam `dd/mm/aaaa` (também `7/11/2026`, `07-11-2026` e `07.11.2026`) e `aaaa-mm-dd`. Colunas que não casam com nenhum nome abaixo são ignoradas e listadas em `unknown_columns` da importação. Fórmulas nunca são executadas: só o valor guardado é lido.",
    ) },
    { kind: "table", head: [t("Column", "Coluna"), t("Required", "Obrigatória"), t("What it is", "O que é")], rows: [
      ["`cnpj_prestador`", t("if no company is chosen", "se não escolher a empresa"), t("CNPJ of the company that issues the row.", "CNPJ da empresa que emite a linha.")],
      ["`tomador_documento`", t("no", "não"), t("Customer CPF or CNPJ, with or without punctuation. Leading zeros lost by Excel are restored.", "CPF ou CNPJ do tomador, com ou sem pontuação. Zeros à esquerda perdidos pelo Excel são restaurados.")],
      ["`tomador_nome`", t("no", "não"), t("Customer name.", "Nome do tomador.")],
      ["`tomador_email`", t("no", "não"), t("Customer e-mail, to send the invoice.", "E-mail do tomador, para enviar a nota.")],
      ["`descricao`", t("yes", "sim"), t("Service description.", "Descrição do serviço.")],
      ["`valor`", t("yes", "sim"), t("Amount in BRL, up to 2 decimals.", "Valor em reais, com até 2 casas decimais.")],
      ["`codigo_servico`", t("no", "não"), t("National service code (6 digits). Empty uses the company default.", "Código nacional do serviço (6 dígitos). Vazio usa o padrão da empresa.")],
      ["`data_competencia`", t("no", "não"), t("Competence date. Empty uses today (America/Sao_Paulo).", "Data de competência. Vazio usa hoje (America/Sao_Paulo).")],
    ] },
    { kind: "heading", level: 2, body: t("Rules", "Regras") },
    { kind: "table", head: [t("Rule", "Regra"), t("Detail", "Detalhe")], rows: [
      [t("Limits", "Limites"), t("Up to 2,000 rows and 10 MB per file; `.csv` or `.xlsx` only. More rows fail the import with `ERROR_IMPORT_TOO_MANY_ROWS`.", "Até 2.000 linhas e 10 MB por arquivo; só `.csv` ou `.xlsx`. Mais linhas falham a importação com `ERROR_IMPORT_TOO_MANY_ROWS`.")],
      [t("Company", "Empresa"), t("From the `cnpj_prestador` column or from `companyId`. A row with no company is `invalid` (`ERROR_IMPORT_COMPANY_REQUIRED`); a CNPJ different from the chosen company is `invalid` (`ERROR_IMPORT_COMPANY_MISMATCH`).", "Da coluna `cnpj_prestador` ou de `companyId`. Uma linha sem empresa fica `invalid` (`ERROR_IMPORT_COMPANY_REQUIRED`); um CNPJ diferente da empresa escolhida fica `invalid` (`ERROR_IMPORT_COMPANY_MISMATCH`).")],
      [t("Environment", "Ambiente"), t("An import belongs to the environment of the key that created it: a `test` key only sees `test` imports, a `live` key only `live` ones.", "Uma importação pertence ao ambiente da chave que a criou: uma chave `test` só vê importações de `test`, uma chave `live` só as de `live`.")],
      [t("Idempotency", "Idempotência"), t("Each line has its own key (`import:<id>:<line>`), so repeating `emit` or retrying a job never issues a line twice.", "Cada linha tem sua própria chave (`import:<id>:<linha>`), então repetir o `emit` ou refazer um job nunca emite uma linha duas vezes.")],
      [t("Not supported", "Não suportado"), t("`SCHEDULE` and `RECURRING` are not accepted inside a spreadsheet.", "`SCHEDULE` e `RECURRING` não são aceitos dentro de uma planilha.")],
      [t("Permissions", "Permissões"), t("Reading (`GET`) needs `invoices_view`; upload, fix, emit and discard need `invoices_issue`.", "Leitura (`GET`) exige `invoices_view`; enviar, corrigir, emitir e descartar exigem `invoices_issue`.")],
    ] },
    { kind: "heading", level: 2, body: t("Status and counters", "Status e contadores") },
    { kind: "table", head: ["status", t("Meaning", "Significado")], rows: [
      ["`processing`", t("The file is being read and every row checked.", "O arquivo está sendo lido e cada linha conferida.")],
      ["`ready`", t("Read. You can review, fix and emit.", "Lido. Dá para revisar, corrigir e emitir.")],
      ["`emitting`", t("Issuing. Some invoices may still be waiting for the city.", "Emitindo. Algumas notas podem ainda aguardar a prefeitura.")],
      ["`done`", t("Nothing is left in progress. Rows awaiting credits can still be issued again.", "Nada mais em andamento. Linhas aguardando créditos ainda podem ser emitidas de novo.")],
      ["`failed`", t("The file could not be read (empty, too many rows or not a real spreadsheet), or the chosen company no longer exists (`ERROR_IMPORT_COMPANY_NOT_FOUND`); see `error_code`.", "O arquivo não pôde ser lido (vazio, linhas demais ou não é uma planilha de verdade), ou a empresa escolhida não existe mais (`ERROR_IMPORT_COMPANY_NOT_FOUND`); veja o `error_code`.")],
    ] },
    { kind: "text", body: t(
      "`counters`: `total`, `valid`, `invalid`, `accepted` (saved and queued for issuing), `authorized` (the city already authorized), `awaiting_credits` (turned away for lack of credits: **not an error**), `failed` (invalid rows plus invoices the city refused), `pending` (still waiting or in progress), `valid_amount` and `awaiting_amount` in BRL. While issuing, `authorized_amount`, `pending_amount` and `failed_amount` show in BRL how much is already authorized, still in progress and refused (invalid rows never count, since they never went out).",
      "`counters`: `total`, `valid`, `invalid`, `accepted` (salvas e na fila de emissão), `authorized` (a prefeitura já autorizou), `awaiting_credits` (recusadas por falta de créditos: **não são erro**), `failed` (linhas inválidas mais as notas que a prefeitura recusou), `pending` (ainda aguardando ou em andamento), `valid_amount` e `awaiting_amount` em reais. Durante a emissão, `authorized_amount`, `pending_amount` e `failed_amount` mostram em reais quanto já foi autorizado, quanto está em andamento e quanto foi recusado (linhas inválidas nunca entram, porque não chegaram a ser enviadas).",
    ) },
    ...endpoints(locale),
    { kind: "heading", level: 3, body: t("Other routes", "Outras rotas") },
    { kind: "table", head: [t("Method", "Método"), t("Route", "Rota"), t("Description", "Descrição"), "Status"], rows: [
      ["DELETE", "`/v1/imports/:id`", t("Discards an import that was not emitted (nothing is issued).", "Descarta uma importação que ainda não foi emitida (nada é emitido)."), "204"],
      ["GET", "`/v1/imports/template`", t("Downloads the spreadsheet template (CSV).", "Baixa o modelo de planilha (CSV)."), "200"],
      ["GET", "`/v1/imports/:id/errors.csv`", t("Downloads only the rows that need attention, streamed. Rows that only wait for credits are left out.", "Baixa só as linhas que pedem atenção, em fluxo. As linhas que só aguardam créditos ficam de fora."), "200"],
    ] },
    { kind: "heading", level: 2, body: t("When credits run out", "Quando os créditos acabam") },
    { kind: "text", body: t(
      "Running out of credits is not a failure of the spreadsheet. Issuing stops, the rows that were not sent are kept as `awaiting_credits` (`ERROR_MONTHLY_LIMIT_EXCEEDED`, `ERROR_INSUFFICIENT_CREDITS` and similar codes on the rows) and nothing is lost. Top up your credits and call `POST /v1/imports/:id/emit` again: only those rows are sent, with the same keys. You can find the import later with `GET /v1/imports`.",
      "Ficar sem créditos não é falha da planilha. A emissão para, as linhas que não foram enviadas ficam como `awaiting_credits` (`ERROR_MONTHLY_LIMIT_EXCEEDED`, `ERROR_INSUFFICIENT_CREDITS` e códigos parecidos nas linhas) e nada se perde. Recarregue os créditos e chame `POST /v1/imports/:id/emit` de novo: só essas linhas são enviadas, com as mesmas chaves. Você reencontra a importação depois com `GET /v1/imports`.",
    ) },
    { kind: "callout", tone: "accent", body: t(
      "In `test`, issuing does not use credits, so this is the way to try a spreadsheet before the real one. Use real CPFs and CNPJs in `live`: the city checks them against the tax registry and refuses invented ones.",
      "Em `test`, emitir não usa créditos, então este é o jeito de experimentar uma planilha antes da de verdade. Use CPFs e CNPJs reais em `live`: a prefeitura confere no cadastro e recusa os inventados.",
    ) },
    { kind: "heading", level: 2, body: t("Through MCP", "Pelo MCP") },
    { kind: "text", body: t(
      "Assistants can run the same flow with the tools `import_create`, `import_list`, `import_get`, `import_rows`, `import_fix_row`, `import_emit` and `import_discard` (see the MCP page). A spreadsheet sent through MCP is text inside the message: CSV in `content` (or an `.xlsx` in `content_base64`), up to 1 MB; bigger files go through `POST /v1/imports`.",
      "Assistentes podem fazer o mesmo fluxo com as ferramentas `import_create`, `import_list`, `import_get`, `import_rows`, `import_fix_row`, `import_emit` e `import_discard` (veja a página de MCP). Uma planilha enviada por MCP é texto dentro da mensagem: CSV em `content` (ou um `.xlsx` em `content_base64`), até 1 MB; arquivos maiores vão por `POST /v1/imports`.",
    ) },
  ];
  return {
    title: t("Import spreadsheet", "Importar planilha"),
    description: t(
      "Issue invoices in bulk from a CSV or Excel spreadsheet: upload, review, issue and follow the counters, by API or MCP.",
      "Emita notas em lote a partir de uma planilha CSV ou Excel: envio, revisão, emissão e acompanhamento dos contadores, por API ou MCP.",
    ),
    blocks,
  };
}
