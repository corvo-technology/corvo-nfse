import type { NFE_SLUGS } from "./slugs";
import type { DocBlock, DocSection, DocsLocale } from "./types";

/** Both languages come from one builder, so the pages can never drift apart in structure. */
const loc = <T>(locale: DocsLocale, en: T, pt: T): T => (locale === "pt" ? pt : en);

export type NfeSlug = (typeof NFE_SLUGS)[number];

const BODY = `{
  "type": "nfe",
  "companyId": "5b8b6a0e-3c6f-4f4e-9a1b-0d7a6d5c2e11",
  "recipient": {
    "taxId": "123.456.789-09",
    "name": "Maria da Silva",
    "indIeDest": 9,
    "email": "maria@example.com",
    "address": {
      "street": "Rua das Flores",
      "number": "10",
      "district": "Centro",
      "zip": "01001-000",
      "cityCode": "3550308",
      "city": "São Paulo",
      "state": "SP"
    }
  },
  "items": [
    {
      "code": "SKU1",
      "description": "Camiseta de algodão",
      "ncm": "61091000",
      "cfop": "5102",
      "unit": "UN",
      "quantity": 2,
      "unitPrice": 10,
      "tax": { "csosn": "102" }
    }
  ],
  "payments": [{ "tPag": "17", "amount": 20 }]
}`;

const ACCEPTED = `{
  "data": {
    "type": "nfe",
    "id": "0b7f2f0e-8f43-4f6e-8a35-6a3b0f1d9c77",
    "status": "queued"
  }
}`;

const VALID = `{
  "data": {
    "valid": true,
    "accessKeyPreview": "35261111222333000181550010000000011234567891"
  }
}`;

const ISSUES = `{
  "statusCode": 422,
  "code": "ERROR_NFE_VALIDATION_FAILED",
  "type": "validation",
  "message": "The NF-e has problems; see details",
  "details": [
    { "field": "items[1].ncm", "code": "NCM_INVALID", "message": "NCM must have 8 digits" }
  ]
}`;

const SETTINGS = `{
  "data": {
    "companyId": "5b8b6a0e-3c6f-4f4e-9a1b-0d7a6d5c2e11",
    "stateRegistration": "110042490114",
    "crt": 1,
    "defaultSeries": 1,
    "defaultNatOp": "Venda de mercadoria",
    "defaultCsosn": "102",
    "missing": []
  }
}`;

const text = (body: string): DocBlock => ({ kind: "text", body });
const heading = (body: string): DocBlock => ({ kind: "heading", level: 2, body });
const list = (items: string[]): DocBlock => ({ kind: "list", items });
const callout = (tone: "warn" | "accent" | "danger", body: string): DocBlock => ({ kind: "callout", tone, body });

function overview(locale: DocsLocale): DocSection {
  const l = <T,>(en: T, pt: T) => loc(locale, en, pt);
  return {
    title: l("NF-e (products)", "NF-e (produtos)"),
    description: l(
      "Issue NF-e (model 55) through the same /v1/invoices routes, in test mode (homologação), for Simples Nacional companies in SP and SVRS states.",
      "Emita NF-e (modelo 55) pelas mesmas rotas /v1/invoices, em teste (homologação), para empresas do Simples Nacional em SP e nos estados da SVRS.",
    ),
    blocks: [
      text(l(
        "NF-e is the invoice for goods (products), different from the NFS-e, which is the invoice for services. In Corvo it lives in the same routes as the NFS-e: `/v1/invoices`. What changes the document is the `type`: send `type: \"nfe\"` to create one, or `?type=nfe` to list. A request without `type` is an NFS-e, exactly as before.",
        "A NF-e é a nota fiscal de produto (mercadoria), diferente da NFS-e, que é a nota de serviço. Na Corvo ela vive nas mesmas rotas da NFS-e: `/v1/invoices`. O que muda o documento é o `type`: mande `type: \"nfe\"` para criar uma, ou `?type=nfe` para listar. Uma chamada sem `type` é NFS-e, como sempre foi.",
      )),
      callout("warn", l(
        "**Phase 1 limits.** Test mode only (homologação): notes issued now have no tax value and the SEFAZ production environment is closed. Only Simples Nacional and MEI companies (CRT 1 or 4), with CSOSN 102 or 400. Only the states SP and the ones served by the SVRS that Corvo already released. **Corvo does not calculate taxes**: you inform the CFOP, the NCM and the CSOSN of each item, as your accountant told you.",
        "**Limites da Fase 1.** Só teste (homologação): as notas emitidas agora não têm valor fiscal e a produção da SEFAZ está fechada. Só empresas do Simples Nacional e MEI (CRT 1 ou 4), com CSOSN 102 ou 400. Só SP e os estados da SVRS que a Corvo já liberou. **A Corvo não calcula imposto**: você informa o CFOP, o NCM e o CSOSN de cada item, como seu contador orientou.",
      )),
      callout("accent", l(
        "Selling to a consumer at the counter? That is the **NFC-e** (model 65), with its own page: same routes, `type: \"nfce\"`.",
        "Vendendo para o consumidor no balcão? Essa é a **NFC-e** (modelo 65), com página própria: as mesmas rotas, `type: \"nfce\"`.",
      )),
      heading(l("Release", "Liberação")),
      text(l(
        "NF-e is released account by account. While it is not released for your account, every NF-e route answers `404` and the NF-e screens and MCP tools do not appear; NFS-e is never affected. To get it released, talk to Corvo. On a self-hosted instance, the operator turns it on (see the runbook `docs/fiscal/runbooks/nfe-homologacao.md`).",
        "A NF-e é liberada conta por conta. Enquanto não estiver liberada para a sua conta, toda rota de NF-e responde `404` e as telas e ferramentas MCP de NF-e não aparecem; a NFS-e nunca é afetada. Para liberar, fale com a Corvo. Numa instalação self-hosted, quem opera liga a NF-e (veja o runbook `docs/fiscal/runbooks/nfe-homologacao.md`).",
      )),
      heading(l("The routes", "As rotas")),
      {
        kind: "table",
        head: [l("Method", "Método"), l("Path", "Caminho"), l("What it does", "O que faz")],
        rows: [
          ["GET/PUT", "`/v1/companies/:id/nfe-settings`", l("Read and set IE, CRT, series and defaults of the company", "Ler e definir IE, CRT, série e padrões da empresa")],
          ["POST", "`/v1/invoices/validate`", l("Dry-run: checks everything, sends and charges nothing", "Teste a seco: confere tudo, não envia nem cobra")],
          ["POST", "`/v1/invoices`", l("Issue an NF-e (`type: \"nfe\"`), needs `Idempotency-Key`", "Emitir uma NF-e (`type: \"nfe\"`), exige `Idempotency-Key`")],
          ["GET", "`/v1/invoices?type=nfe`", l("List NF-e (`type=all` lists NFS-e and NF-e together)", "Listar NF-e (`type=all` lista NFS-e e NF-e juntas)")],
          ["GET", "`/v1/invoices/:id`", l("Read one NF-e", "Ler uma NF-e")],
          ["PUT", "`/v1/invoices/:id`", l("Fix and send a rejected NF-e again (same number)", "Corrigir e reenviar uma NF-e rejeitada (mesmo número)")],
          ["POST", "`/v1/invoices/:id/sync`", l("Ask the SEFAZ about the note by its access key", "Perguntar à SEFAZ pela chave de acesso")],
          ["POST", "`/v1/invoices/:id/discard`", l("Give up a rejected NF-e", "Desistir de uma NF-e rejeitada")],
          ["POST", "`/v1/invoices/:id/cancel`", l("Cancel an authorized NF-e", "Cancelar uma NF-e autorizada")],
          ["POST", "`/v1/invoices/:id/corrections`", l("Send a correction letter (CC-e)", "Enviar uma carta de correção (CC-e)")],
          ["GET", "`/v1/invoices/:id/events`", l("States and fiscal events of the note", "Situações e eventos fiscais da nota")],
          ["GET", "`/v1/invoices/:id/xml` · `/pdf`", l("Authorized XML and DANFE", "XML autorizado e DANFE")],
          ["POST", "`/v1/invoices/:id/download-url`", l("A temporary link to the XML or the DANFE", "Um link temporário para o XML ou o DANFE")],
          ["GET/POST", "`/v1/invoices/inutilizations`", l("List and request the inutilization of number ranges", "Listar e pedir a inutilização de faixas de números")],
          ["GET", "`/v1/invoices/number-gaps?type=nfe`", l("Numbers that were skipped", "Números que ficaram pulados")],
        ],
      },
      text(l(
        "An operation that does not exist for a type answers `422` with `INVOICE_OPERATION_NOT_SUPPORTED` (for example, a correction letter on an NFS-e). An NF-e answer carries `type: \"nfe\"`; an NFS-e answer has no `type`, and absent means NFS-e.",
        "Uma operação que não existe para um tipo responde `422` com `INVOICE_OPERATION_NOT_SUPPORTED` (por exemplo, carta de correção numa NFS-e). A resposta de uma NF-e traz `type: \"nfe\"`; a de uma NFS-e não tem `type`, e ausente quer dizer NFS-e.",
      )),
      heading(l("SDKs and generated clients", "SDKs e clientes gerados")),
      text(l(
        "Nothing about `/v1/invoices` for NFS-e changed: the same operations, the same fields. The NF-e only adds the optional `type`, the new operations above and the `NF-e` tag in the OpenAPI. A client generated from `openapi.json` already has them; a hand-written one only needs to send `type: \"nfe\"` and the `Idempotency-Key` header. The MCP tools `nfse_issue`, `nfse_list`, `nfse_get`, `nfse_cancel` and others also take `type`.",
        "Nada de `/v1/invoices` para NFS-e mudou: as mesmas operações, os mesmos campos. A NF-e só soma o `type` opcional, as operações novas acima e a tag `NF-e` no OpenAPI. Um cliente gerado de `openapi.json` já tem tudo; um escrito à mão só precisa mandar `type: \"nfe\"` e o cabeçalho `Idempotency-Key`. As ferramentas MCP `nfse_issue`, `nfse_list`, `nfse_get`, `nfse_cancel` e outras também aceitam `type`.",
      )),
    ],
  };
}

function company(locale: DocsLocale): DocSection {
  const l = <T,>(en: T, pt: T) => loc(locale, en, pt);
  return {
    title: l("NF-e: company and state registration", "NF-e: empresa e inscrição estadual"),
    description: l(
      "What a company needs before issuing an NF-e: address, state registration (IE), tax regime and the series.",
      "O que a empresa precisa ter antes de emitir NF-e: endereço, inscrição estadual (IE), regime tributário e série.",
    ),
    blocks: [
      text(l(
        "To issue an NF-e, the company needs a complete address (street, number, district, ZIP and the IBGE city code), the state (UF), the **state registration (IE)** and the **tax regime (CRT)**. The NFS-e does not need the IE or the CRT, so a company that only issues services is not asked for them.",
        "Para emitir NF-e, a empresa precisa de endereço completo (rua, número, bairro, CEP e código IBGE do município), o estado (UF), a **inscrição estadual (IE)** e o **regime tributário (CRT)**. A NFS-e não pede IE nem CRT, então quem só emite serviço não precisa informar.",
      )),
      heading(l("Set the NF-e data", "Informar os dados de NF-e")),
      { kind: "code", language: "bash", label: "PUT /v1/companies/:id/nfe-settings", code: `curl -X PUT https://api.corvo.tech/v1/companies/$COMPANY_ID/nfe-settings \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "stateRegistration": "110042490114", "defaultSeries": 1 }'` },
      { kind: "code", language: "json", label: l("Response", "Resposta"), code: SETTINGS },
      {
        kind: "table",
        head: [l("Field", "Campo"), l("What it is", "O que é")],
        rows: [
          ["`stateRegistration`", l("IE of the company, digits only. Corvo checks it is valid for the company's state. `ISENTO` is not valid for an issuer.", "IE da empresa, só números. A Corvo confere se vale para o estado da empresa. `ISENTO` não vale para quem emite.")],
          ["`crt`", l("Optional. It follows the tax regime of the company (`1` Simples Nacional, `4` MEI); send it only to override. Other regimes are not accepted yet.", "Opcional. Segue o regime tributário da empresa (`1` Simples Nacional, `4` MEI); só envie para forçar outro valor. Outros regimes ainda não são aceitos.")],
          ["`defaultSeries`", l("Series of the new notes (0 to 999, default 1).", "Série das notas novas (0 a 999, padrão 1).")],
          ["`defaultNatOp`", l("Nature of the operation when the note does not send one (default `Venda de mercadoria`).", "Natureza da operação quando a nota não manda uma (padrão `Venda de mercadoria`).")],
          ["`defaultCsosn`", l("`102` (no tax credit) or `400` (not taxed), used by items without their own `tax.csosn`.", "`102` (sem crédito de imposto) ou `400` (não tributada), usado pelos itens sem `tax.csosn` próprio.")],
          ["`missing`", l("What the company still lacks to issue (`state_registration`, `crt`, `address_street`...). Empty means ready.", "O que ainda falta para emitir (`state_registration`, `crt`, `address_street`...). Vazio quer dizer pronta.")],
        ],
      },
      callout("accent", l(
        "A wrong IE answers `422` with `STATE_REGISTRATION_INVALID`. A company that is not complete answers `COMPANY_NFE_INCOMPLETE` with the missing fields in `details`, before any number is used.",
        "Uma IE errada responde `422` com `STATE_REGISTRATION_INVALID`. Uma empresa incompleta responde `COMPANY_NFE_INCOMPLETE` com os campos que faltam em `details`, antes de gastar qualquer número.",
      )),
      text(l(
        "In the dashboard, the same data is in the company page, in the **NF-e** section, which also lists what is missing. It only appears when NF-e is released for the account.",
        "No painel, os mesmos dados ficam na página da empresa, na seção **NF-e**, que também lista o que falta. Ela só aparece quando a NF-e está liberada para a conta.",
      )),
    ],
  };
}

function issue(locale: DocsLocale): DocSection {
  const l = <T,>(en: T, pt: T) => loc(locale, en, pt);
  return {
    title: l("NF-e: validate, issue and follow", "NF-e: validar, emitir e acompanhar"),
    description: l(
      "Check an NF-e with the dry-run, issue it with an Idempotency-Key and follow its states until it is authorized.",
      "Confira uma NF-e com o teste a seco, emita com Idempotency-Key e acompanhe as situações até a autorização.",
    ),
    blocks: [
      heading(l("1. Validate (dry-run)", "1. Validar (teste a seco)")),
      text(l(
        "`POST /v1/invoices/validate` runs the same checks as the real issue, builds the note and checks it against the official layout, but sends nothing to the SEFAZ, reserves no number and charges nothing. It answers the access key the note would have. Add `?includeXml=true` to also get the XML.",
        "`POST /v1/invoices/validate` faz as mesmas conferências da emissão de verdade, monta a nota e confere com o layout oficial, mas não envia nada à SEFAZ, não reserva número e não cobra. Responde a chave de acesso que a nota teria. Some `?includeXml=true` para receber também o XML.",
      )),
      { kind: "code", language: "json", label: l("Request body (the same one to issue)", "Corpo da chamada (o mesmo para emitir)"), code: BODY },
      { kind: "code", language: "json", label: l("Answer 200", "Resposta 200"), code: VALID },
      text(l(
        "When something is wrong the answer is `422` and `details` lists each field with its path, such as `items[1].ncm`. The dashboard marks those fields in the form.",
        "Quando algo está errado a resposta é `422` e `details` lista cada campo com o caminho, como `items[1].ncm`. O painel marca esses campos no formulário.",
      )),
      { kind: "code", language: "json", label: l("Answer 422", "Resposta 422"), code: ISSUES },
      heading(l("2. Issue", "2. Emitir")),
      { kind: "code", language: "bash", label: "POST /v1/invoices", code: `curl -X POST https://api.corvo.tech/v1/invoices \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Idempotency-Key: pedido-1042" \\
  -H "Content-Type: application/json" \\
  -d @nfe.json` },
      { kind: "code", language: "json", label: l("Answer 202", "Resposta 202"), code: ACCEPTED },
      list([
        l("`Idempotency-Key` (1 to 200 characters) is required. Repeating the same key with the same body returns the same note (`200`, `replayed: true`); the same key with another body answers `409` `IDEMPOTENCY_KEY_REUSED`. A retry never issues two notes.", "`Idempotency-Key` (de 1 a 200 caracteres) é obrigatório. Repetir a mesma chave com o mesmo corpo devolve a mesma nota (`200`, `replayed: true`); a mesma chave com outro corpo responde `409` `IDEMPOTENCY_KEY_REUSED`. Um reenvio nunca emite duas notas."),
        l("`recipient.indIeDest`: `9` non-taxpayer (most people), `1` taxpayer (needs `stateRegistration`), `2` exempt.", "`recipient.indIeDest`: `9` não contribuinte (a maioria das pessoas), `1` contribuinte (exige `stateRegistration`), `2` isento."),
        l("`items[].cfop`: `5xxx` inside the state, `6xxx` for another state. `items[].ncm`: 8 digits. `items[].tax.csosn`: `102` or `400`; left out, the company default applies.", "`items[].cfop`: `5xxx` dentro do estado, `6xxx` para outro estado. `items[].ncm`: 8 dígitos. `items[].tax.csosn`: `102` ou `400`; sem ele vale o padrão da empresa."),
        l("`payments` minus `change` must equal the total of the note. Totals are computed by Corvo from the items (each item rounded to cents).", "`payments` menos `change` precisa dar o total da nota. Os totais são calculados pela Corvo a partir dos itens (cada item arredondado em centavos)."),
        l("`sendEmail` (default `true`): when the recipient has an e-mail, the XML and the DANFE are sent after the authorization.", "`sendEmail` (padrão `true`): quando o destinatário tem e-mail, o XML e o DANFE são enviados depois da autorização."),
        l("Text fields accept letters, digits and common punctuation. Emoji and line breaks are refused with the field named, before the SEFAZ.", "Os campos de texto aceitam letras, números e pontuação comum. Emoji e quebra de linha são recusados, com o campo indicado, antes da SEFAZ."),
      ]),
      heading(l("3. Follow", "3. Acompanhar")),
      text(l(
        "Issuing is asynchronous, like the NFS-e. Read the note with `GET /v1/invoices/:id` or wait for the webhook. The states are:",
        "A emissão é assíncrona, como a da NFS-e. Leia a nota com `GET /v1/invoices/:id` ou espere o webhook. As situações são:",
      )),
      {
        kind: "table",
        head: [l("Status", "Situação"), l("Meaning", "Significado")],
        rows: [
          ["`queued`, `processing`", l("Waiting to be sent, or being sent to the SEFAZ.", "Esperando para ser enviada, ou sendo enviada à SEFAZ.")],
          ["`authorized`", l("The SEFAZ authorized it. `protocol`, `authorizedAt` and, a moment later, `documentsReady` appear.", "A SEFAZ autorizou. Aparecem `protocol`, `authorizedAt` e, pouco depois, `documentsReady`.")],
          ["`rejected`", l("The SEFAZ refused it. See `lastError`. The number is kept: fix it and send again (`PUT`) or discard it.", "A SEFAZ recusou. Veja `lastError`. O número fica guardado: corrija e reenvie (`PUT`) ou descarte.")],
          ["`denied`", l("The SEFAZ denied it (final).", "A SEFAZ denegou (final).")],
          ["`retry_pending`", l("The SEFAZ was unavailable. Corvo tries again by itself.", "A SEFAZ estava fora do ar. A Corvo tenta de novo sozinha.")],
          ["`reconciliation_required`", l("No answer from the SEFAZ. Corvo checks by the access key, without issuing again.", "Sem resposta da SEFAZ. A Corvo confere pela chave de acesso, sem emitir de novo.")],
          ["`manual_review`", l("The check could not confirm. Ask again with `POST /v1/invoices/:id/sync`.", "A conferência não conseguiu confirmar. Pergunte de novo com `POST /v1/invoices/:id/sync`.")],
          ["`cancelling`, `cancelled`", l("Cancellation requested, then registered.", "Cancelamento pedido, depois registrado.")],
          ["`discarded`", l("A rejected note that was given up (final). Its number needs an inutilization.", "Uma nota rejeitada de que se desistiu (final). O número dela precisa ser inutilizado.")],
        ],
      },
      callout("accent", l(
        "A worker that dies after sending never makes a second note: the number, the key and the signed XML are saved before the sending, and Corvo asks the SEFAZ for the same key.",
        "Se o processo cair depois do envio, nunca nasce uma segunda nota: o número, a chave e o XML assinado são gravados antes do envio, e a Corvo pergunta à SEFAZ pela mesma chave.",
      )),
    ],
  };
}

function errors(locale: DocsLocale): DocSection {
  const l = <T,>(en: T, pt: T) => loc(locale, en, pt);
  return {
    title: l("NF-e: errors and hints", "NF-e: erros e dicas"),
    description: l(
      "The three kinds of NF-e error, the codes you may see and what to do about each.",
      "Os três tipos de erro da NF-e, os códigos que você pode ver e o que fazer em cada um.",
    ),
    blocks: [
      text(l(
        "An error of a note (`lastError`) and a failed request both say who has to act with `type`:",
        "O erro de uma nota (`lastError`) e o de uma chamada que falhou dizem quem precisa agir pelo campo `type`:",
      )),
      {
        kind: "table",
        head: ["`type`", l("Who acts", "Quem age"), l("What to do", "O que fazer")],
        rows: [
          ["`validation`", l("You", "Você"), l("Fix the fields in `details` (or, for a rejected note, what the SEFAZ refused) and send again.", "Corrija os campos de `details` (ou, numa nota rejeitada, o que a SEFAZ recusou) e envie de novo.")],
          ["`configuration`", l("You", "Você"), l("Complete the company (IE, CRT, address), wait for the release of the state or of NF-e.", "Complete a empresa (IE, CRT, endereço) ou espere a liberação do estado ou da NF-e.")],
          ["`communication`", l("Nobody", "Ninguém"), l("The SEFAZ did not answer. Corvo checks again by itself, without issuing twice.", "A SEFAZ não respondeu. A Corvo confere de novo sozinha, sem emitir duas vezes.")],
        ],
      },
      text(l(
        "A rejection by the SEFAZ comes with its `cStat` and `xMotivo`, plus a `hint` in plain words when Corvo knows how to fix it.",
        "Uma rejeição da SEFAZ vem com `cStat` e `xMotivo`, e com uma `hint` em palavras simples quando a Corvo sabe como resolver.",
      )),
      {
        kind: "table",
        head: [l("Code", "Código"), l("Meaning", "Significado")],
        rows: [
          ["`NFE_VALIDATION_FAILED`", l("Fields with problems; see `details` (path, code and message of each).", "Campos com problema; veja `details` (caminho, código e mensagem de cada um).")],
          ["`COMPANY_NFE_INCOMPLETE`", l("The company lacks address, IE or CRT; `details` lists them.", "Falta endereço, IE ou CRT na empresa; `details` lista o que falta.")],
          ["`STATE_REGISTRATION_INVALID`", l("The IE is not valid for the state of the company.", "A IE não vale para o estado da empresa.")],
          ["`UF_NOT_ENABLED`", l("NF-e is not released yet for the state of the company.", "A NF-e ainda não foi liberada para o estado da empresa.")],
          ["`NFE_PRODUCTION_DISABLED`", l("A live company asked for NF-e: production is not released yet.", "Uma empresa de produção pediu NF-e: a produção ainda não foi liberada.")],
          ["`CERTIFICATE_UNUSABLE`", l("The A1 certificate is expired or invalid.", "O certificado A1 está vencido ou inválido.")],
          ["`IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `IDEMPOTENCY_KEY_REUSED`", l("Missing header, wrong size, or one key used with two bodies.", "Cabeçalho ausente, tamanho errado ou uma chave usada com dois corpos.")],
          ["`INVOICE_OPERATION_NOT_SUPPORTED`", l("The operation does not exist for this type of note.", "A operação não existe para esse tipo de nota.")],
          ["`NFE_INVALID_STATE`", l("The action does not apply to the current state of the note.", "A ação não vale para a situação atual da nota.")],
          ["`COMPANY_MISMATCH`", l("The company of a rejected note cannot be changed on resubmission.", "Não dá para trocar a empresa de uma nota rejeitada ao reenviar.")],
          ["`TAX_ID_INVALID`, `RECIPIENT_IE_INVALID`, `NCM_INVALID`, `CFOP_DESTINATION_MISMATCH`, `CSOSN_NOT_SUPPORTED`, `PAYMENTS_TOTAL_MISMATCH`, `TEXT_CHARSET_INVALID`, `OUT_OF_PHASE1_SCOPE`", l("Issues of `details`, each on its field.", "Itens de `details`, cada um no seu campo.")],
          ["`SEFAZ_NO_ANSWER` · `SEFAZ_UNAVAILABLE`", l("Communication: Corvo checks or sends again by itself.", "Comunicação: a Corvo confere ou envia de novo sozinha.")],
        ],
      },
      text(l(
        "The dashboard shows each of these in plain Portuguese or English, with what to do next. Do not rely on the text of `message`: use `code` and `type`.",
        "O painel mostra cada um deles em português ou inglês simples, com o que fazer em seguida. Não dependa do texto de `message`: use `code` e `type`.",
      )),
    ],
  };
}

function events(locale: DocsLocale): DocSection {
  const l = <T,>(en: T, pt: T) => loc(locale, en, pt);
  return {
    title: l("NF-e: cancel, correct and inutilize", "NF-e: cancelar, corrigir e inutilizar"),
    description: l(
      "Cancel an authorized NF-e, send correction letters (CC-e), inutilize numbers and find skipped numbers.",
      "Cancele uma NF-e autorizada, envie cartas de correção (CC-e), inutilize números e encontre números pulados.",
    ),
    blocks: [
      heading(l("Cancel", "Cancelar")),
      { kind: "code", language: "bash", label: "POST /v1/invoices/:id/cancel", code: `curl -X POST https://api.corvo.tech/v1/invoices/$ID/cancel \\
  -H "X-API-Key: $CORVO_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "justification": "Pedido cancelado pelo cliente antes da entrega" }'` },
      text(l(
        "The justification has 15 to 255 characters (`JUSTIFICATION_LENGTH`). The answer is `202` with `cancelling`; when the SEFAZ registers the event the note becomes `cancelled` and the webhook `nfe.document.cancelled` is sent. The SEFAZ has a deadline for cancelling: past it, you see its refusal as it comes. Credit is not given back for a note that was already authorized.",
        "A justificativa tem de 15 a 255 caracteres (`JUSTIFICATION_LENGTH`). A resposta é `202` com `cancelling`; quando a SEFAZ registra o evento a nota vira `cancelled` e o webhook `nfe.document.cancelled` é enviado. A SEFAZ tem um prazo para cancelar: passado o prazo, você vê a recusa dela como veio. O crédito não volta para uma nota que já foi autorizada.",
      )),
      heading(l("Correction letter (CC-e)", "Carta de correção (CC-e)")),
      { kind: "code", language: "bash", label: "POST /v1/invoices/:id/corrections", code: `curl -X POST https://api.corvo.tech/v1/invoices/$ID/corrections \\
  -H "X-API-Key: $CORVO_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "correction": "Corrigir o endereço de entrega para Rua das Flores, 20" }'` },
      list([
        l("15 to 1000 characters (`CORRECTION_LENGTH`). Up to 20 letters per note (`CORRECTION_LIMIT_REACHED`); each one has a `sequence`.", "De 15 a 1000 caracteres (`CORRECTION_LENGTH`). Até 20 cartas por nota (`CORRECTION_LIMIT_REACHED`); cada uma tem uma `sequence`."),
        l("It fixes text. It **cannot** change amounts, taxes, the parties (issuer and recipient) or the dates.", "Ela corrige texto. **Não** pode mudar valores, impostos, as partes (emitente e destinatário) nem as datas."),
        l("The note stays `authorized`; the letter appears in `GET /v1/invoices/:id/events` and the webhook `nfe.document.corrected` is sent.", "A nota continua `authorized`; a carta aparece em `GET /v1/invoices/:id/events` e o webhook `nfe.document.corrected` é enviado."),
      ]),
      heading(l("Inutilize numbers and skipped numbers", "Inutilizar números e números pulados")),
      text(l(
        "NF-e numbers must follow in sequence. When a number will never be used (for example the one of a discarded note), tell the SEFAZ with an inutilization. `GET /v1/invoices/number-gaps?type=nfe` lists the gaps per company and series; Corvo also checks it every day.",
        "Os números da NF-e precisam seguir em sequência. Quando um número nunca será usado (por exemplo o de uma nota descartada), avise a SEFAZ com uma inutilização. `GET /v1/invoices/number-gaps?type=nfe` lista as lacunas por empresa e série; a Corvo também confere todo dia.",
      )),
      { kind: "code", language: "bash", label: "POST /v1/invoices/inutilizations", code: `curl -X POST https://api.corvo.tech/v1/invoices/inutilizations \\
  -H "X-API-Key: $CORVO_API_KEY" -H "Idempotency-Key: inut-2026-11-001" -H "Content-Type: application/json" \\
  -d '{ "type": "nfe", "companyId": "'$COMPANY_ID'", "series": 1, "start": 10, "end": 12,
        "justification": "Numeração pulada por falha do sistema emissor" }'` },
      list([
        l("`type` is required. The justification has 15 to 255 characters. The range is from 1 to 999999999, with the start before the end.", "`type` é obrigatório. A justificativa tem de 15 a 255 caracteres. A faixa vai de 1 a 999999999, com o início antes do fim."),
        l("A range with a note that was not discarded answers `INUTILIZATION_RANGE_IN_USE`: discard the note first. Two requests on the same numbers answer `INUTILIZATION_RANGE_OVERLAP`.", "Uma faixa com uma nota que não foi descartada responde `INUTILIZATION_RANGE_IN_USE`: descarte a nota antes. Dois pedidos sobre os mesmos números respondem `INUTILIZATION_RANGE_OVERLAP`."),
        l("Inutilizing above the last number also moves the counter, so the next NF-e takes the number after the range. The result (`pending`, then `homologada` or `rejected`) is in `GET /v1/invoices/inutilizations` and in the webhooks `nfe.inutilization.completed` and `nfe.inutilization.rejected`.", "Inutilizar acima do último número também move o contador, e a próxima NF-e usa o número depois da faixa. O resultado (`pending`, depois `homologada` ou `rejected`) fica em `GET /v1/invoices/inutilizations` e nos webhooks `nfe.inutilization.completed` e `nfe.inutilization.rejected`."),
      ]),
      callout("warn", l(
        "An inutilization cannot be undone: the numbers can never be used again. In the dashboard, the page **Skipped numbers** shows the gaps and asks for the justification before sending.",
        "A inutilização não pode ser desfeita: os números nunca mais poderão ser usados. No painel, a página **Números pulados** mostra as lacunas e pede a justificativa antes de enviar.",
      )),
    ],
  };
}

function files(locale: DocsLocale): DocSection {
  const l = <T,>(en: T, pt: T) => loc(locale, en, pt);
  return {
    title: l("NF-e: files and webhooks", "NF-e: arquivos e webhooks"),
    description: l(
      "Download the authorized XML and the DANFE, and receive the nfe.* webhook events.",
      "Baixe o XML autorizado e o DANFE, e receba os eventos de webhook nfe.*.",
    ),
    blocks: [
      heading(l("Files", "Arquivos")),
      text(l(
        "After the authorization, Corvo builds the authorized XML (`nfeProc`) and the DANFE (the printable PDF) and sets `documentsReady: true` on the note. Before that, asking for a file answers `409` `DOCUMENTS_NOT_READY`.",
        "Depois da autorização, a Corvo monta o XML autorizado (`nfeProc`) e o DANFE (o PDF para imprimir) e marca `documentsReady: true` na nota. Antes disso, pedir um arquivo responde `409` `DOCUMENTS_NOT_READY`.",
      )),
      list([
        l("`GET /v1/invoices/:id/xml` and `GET /v1/invoices/:id/pdf` answer the file itself.", "`GET /v1/invoices/:id/xml` e `GET /v1/invoices/:id/pdf` respondem o próprio arquivo."),
        l("`POST /v1/invoices/:id/download-url` with `{ \"format\": \"xml\" | \"pdf\" }` answers a temporary link (`downloadUrl`, `expiresAt`). Another format answers `NFE_DOWNLOAD_FORMAT_INVALID`.", "`POST /v1/invoices/:id/download-url` com `{ \"format\": \"xml\" | \"pdf\" }` responde um link temporário (`downloadUrl`, `expiresAt`). Outro formato responde `NFE_DOWNLOAD_FORMAT_INVALID`."),
        l("The monthly package for the accountant (`GET /v1/companies/:id/invoice-package`) also carries the NF-e of the month when NF-e is released.", "O pacote mensal do contador (`GET /v1/companies/:id/invoice-package`) também leva as NF-e do mês quando a NF-e está liberada."),
      ]),
      callout("accent", l(
        "The XML has the personal data of the recipient. Corvo never writes a whole XML in its logs and never hands one out without your key.",
        "O XML tem dados pessoais do destinatário. A Corvo nunca escreve um XML inteiro nos logs e nunca entrega um sem a sua chave.",
      )),
      heading(l("Webhooks", "Webhooks")),
      text(l(
        "NF-e events use the same webhook registration and signature as the NFS-e ones (see Webhooks). The `data` carries `documentType: \"nfe\"` and `documentId` instead of `invoiceId`; the NFS-e events do not change. List the deliveries of a note with the `documentId`.",
        "Os eventos da NF-e usam o mesmo cadastro e a mesma assinatura dos webhooks da NFS-e (veja Webhooks). O `data` traz `documentType: \"nfe\"` e `documentId` no lugar de `invoiceId`; os eventos da NFS-e não mudam. Liste as entregas de uma nota pelo `documentId`.",
      )),
      {
        kind: "table",
        head: [l("Event", "Evento"), l("When", "Quando")],
        rows: [
          ["`nfe.document.authorized`", l("The SEFAZ authorized the note.", "A SEFAZ autorizou a nota.")],
          ["`nfe.document.rejected` · `nfe.document.denied`", l("The SEFAZ refused or denied it.", "A SEFAZ recusou ou denegou.")],
          ["`nfe.document.failed`", l("A failure that needs your look.", "Uma falha que precisa do seu olhar.")],
          ["`nfe.document.reconciliation_required` · `nfe.document.manual_review`", l("No answer, being checked; or the check could not confirm.", "Sem resposta, em conferência; ou a conferência não conseguiu confirmar.")],
          ["`nfe.document.cancelled` · `nfe.document.cancellation_rejected`", l("Cancellation registered or refused.", "Cancelamento registrado ou recusado.")],
          ["`nfe.document.corrected`", l("A correction letter was registered.", "Uma carta de correção foi registrada.")],
          ["`nfe.document.documents_ready`", l("The XML and the DANFE are ready to download.", "O XML e o DANFE estão prontos para baixar.")],
          ["`nfe.document.email_sent` · `nfe.document.email_failed`", l("The e-mail to the recipient went or failed.", "O e-mail ao destinatário foi enviado ou falhou.")],
          ["`nfe.inutilization.completed` · `nfe.inutilization.rejected`", l("An inutilization was accepted or refused.", "Uma inutilização foi aceita ou recusada.")],
          ["`nfe.contingency.entered` · `nfe.contingency.exited`", l("The NF-e of a state started, or stopped, going out through the SVC. The `data` carries `uf`, `tpAmb`, `authority` (`SVCAN` or `SVCRS`) and `dhCont`; there is no `documentId`.", "A NF-e de um estado passou a sair, ou deixou de sair, pela SVC. O `data` traz `uf`, `tpAmb`, `authority` (`SVCAN` ou `SVCRS`) e `dhCont`; não há `documentId`.")],
        ],
      },
      heading(l("When the SEFAZ of the state is down (SVC)", "Quando a SEFAZ do estado está fora do ar (SVC)")),
      text(l(
        "If the SEFAZ of the state of the company stops answering while the rest of the government still does, Corvo sends the NF-e through the **SEFAZ Virtual de Contingência** (SVC-AN or SVC-RS, depending on the state). It is automatic: you do nothing and the request does not change.",
        "Se a SEFAZ do estado da empresa parar de responder enquanto o resto do governo continua no ar, a Corvo envia a NF-e pela **SEFAZ Virtual de Contingência** (SVC-AN ou SVC-RS, conforme o estado). É automático: você não faz nada e o pedido não muda.",
      )),
      list([
        l("Only a note that **was never sent** changes: it gets a new key (`tpEmis` 6 or 7) with the same number and series. A note that may already have reached its SEFAZ keeps its key and waits for it; Corvo checks it by key and never numbers it again.", "Só muda a nota que **nunca foi enviada**: ela ganha chave nova (`tpEmis` 6 ou 7) com o mesmo número e série. Uma nota que pode já ter chegado na SEFAZ dela mantém a chave e espera por ela; a Corvo confere pela chave e nunca numera de novo."),
        l("The note is valid. The response shows `emissionType` 6 (SVC-AN) or 7 (SVC-RS), `contingencyAt` and `contingencyReason`; the DANFE says \"EMITIDA EM CONTINGÊNCIA SVC\".", "A nota é válida. A resposta mostra `emissionType` 6 (SVC-AN) ou 7 (SVC-RS), `contingencyAt` e `contingencyReason`; o DANFE diz \"EMITIDA EM CONTINGÊNCIA SVC\"."),
        l("If it is Corvo's own network that cannot reach the government, the SVC does not help (it is a government host too) and the note waits as usual.", "Se quem não alcança o governo é a rede da própria Corvo, a SVC não ajuda (ela também é um endereço do governo) e a nota espera como de costume."),
        l("The NFS-e and the NFC-e do not use the SVC. Inutilization is only made at the SEFAZ of the state.", "A NFS-e e a NFC-e não usam a SVC. A inutilização só é feita na SEFAZ do estado."),
      ]),
    ],
  };
}

const NFCE_BODY = `{
  "type": "nfce",
  "companyId": "5b8b6a0e-3c6f-4f4e-9a1b-0d7a6d5c2e11",
  "recipient": { "taxId": "123.456.789-09" },
  "indPres": 1,
  "items": [
    {
      "code": "CAFE1",
      "description": "Café coado",
      "ncm": "09012100",
      "cfop": "5102",
      "unit": "UN",
      "quantity": 2,
      "unitPrice": 8
    }
  ],
  "payments": [
    {
      "tPag": "03",
      "amount": 16,
      "card": { "tpIntegra": 2, "tBand": "01" }
    }
  ]
}`;

const NFCE_ACCEPTED = `{
  "data": {
    "type": "nfce",
    "id": "9d1c3b8e-5f2a-4a53-b0a4-7c1d7a2e4f10",
    "status": "queued"
  }
}`;

const NFCE_DOC = `{
  "data": {
    "type": "nfce",
    "id": "9d1c3b8e-5f2a-4a53-b0a4-7c1d7a2e4f10",
    "status": "authorized",
    "number": 12,
    "series": 1,
    "accessKey": "35261111222333000181650010000000121234567891",
    "qrCode": "https://www.nfce.fazenda.sp.gov.br/qrcode?p=...",
    "urlChave": "https://www.nfce.fazenda.sp.gov.br/consulta",
    "documentsReady": true
  }
}`;

function nfce(locale: DocsLocale): DocSection {
  const l = <T,>(en: T, pt: T) => loc(locale, en, pt);
  return {
    title: l("NFC-e: consumer sale", "NFC-e: venda ao consumidor"),
    description: l(
      "Issue the NFC-e (model 65), the note for a sale to the final consumer, through the same /v1/invoices routes, in test mode (homologação), starting in SP.",
      "Emita a NFC-e (modelo 65), a nota da venda ao consumidor final, pelas mesmas rotas /v1/invoices, em teste (homologação), começando por SP.",
    ),
    blocks: [
      text(l(
        "The NFC-e is the note of the sale at the counter, to a consumer who often gives no name. It lives in the same routes as the NF-e and the NFS-e: `/v1/invoices`. Send `type: \"nfce\"` to create or validate one, and `?type=nfce` to list. A request without `type` is still an NFS-e. NFS-e and NF-e do not change.",
        "A NFC-e é a nota da venda no balcão, para um consumidor que muitas vezes não dá nem o nome. Ela vive nas mesmas rotas da NF-e e da NFS-e: `/v1/invoices`. Mande `type: \"nfce\"` para criar ou validar, e `?type=nfce` para listar. Uma chamada sem `type` continua sendo NFS-e. A NFS-e e a NF-e não mudam.",
      )),
      callout("warn", l(
        "**Test mode first.** The NFC-e only runs in homologação for now: notes issued here have no tax value and the production of the SEFAZ is closed. Corvo starts with **SP**; another state only enters after its own homologation. Only Simples Nacional and MEI companies, with CSOSN 102 or 400. **Corvo does not calculate taxes**: you inform the CFOP, the NCM and the CSOSN of each item.",
        "**Primeiro em teste.** A NFC-e só roda em homologação por enquanto: as notas emitidas aqui não têm valor fiscal e a produção da SEFAZ está fechada. A Corvo começa por **SP**; outro estado só entra depois da homologação dele. Só empresas do Simples Nacional e MEI, com CSOSN 102 ou 400. **A Corvo não calcula imposto**: você informa o CFOP, o NCM e o CSOSN de cada item.",
      )),
      heading(l("Release and accreditation", "Liberação e credenciamento")),
      list([
        l("**Release in Corvo.** The NFC-e has its own release, apart from the NF-e: until it is released for your account every NFC-e route answers `404` and the screens and MCP tools do not show it. Ask Corvo; on a self-hosted instance, the operator turns it on (runbook `docs/fiscal/runbooks/nfce-homologacao.md`).", "**Liberação na Corvo.** A NFC-e tem liberação própria, separada da NF-e: enquanto não estiver liberada para a sua conta, toda rota de NFC-e responde `404` e as telas e ferramentas MCP não aparecem. Fale com a Corvo; numa instalação self-hosted, quem opera liga (runbook `docs/fiscal/runbooks/nfce-homologacao.md`)."),
        l("**Accreditation at the SEFAZ.** The state registration (IE) of the company must be accredited to issue NFC-e at its state. It is done once, on the SEFAZ site, by the company or its accountant. Without it the SEFAZ refuses the notes.", "**Credenciamento na SEFAZ.** A inscrição estadual (IE) da empresa precisa estar credenciada para emitir NFC-e no estado dela. Faz-se uma vez, no site da SEFAZ, pela empresa ou pelo contador. Sem isso a SEFAZ recusa as notas."),
        l("**No CSC needed.** Corvo uses the QR Code v3 (online), which does not take the CSC (the security code that older QR Codes asked for) nor its id. You have nothing to register or keep.", "**Sem CSC.** A Corvo usa o QR Code v3 (online), que não usa o CSC (o código de segurança que os QR Codes antigos pediam) nem o id dele. Você não tem nada para cadastrar ou guardar."),
        l("**Series.** The NFC-e has its own series (`nfceDefaultSeries` in `PUT /v1/companies/:id/nfe-settings`, default 1) and its own numbering.", "**Série.** A NFC-e tem série própria (`nfceDefaultSeries` em `PUT /v1/companies/:id/nfe-settings`, padrão 1) e numeração própria."),
      ]),
      heading(l("Issue", "Emitir")),
      text(l(
        "Validate with `POST /v1/invoices/validate` (dry-run, same body) and issue with `POST /v1/invoices` and an `Idempotency-Key`, as in the NF-e. The body has no `natOp` and no recipient address, unless the sale is a delivery.",
        "Valide com `POST /v1/invoices/validate` (teste a seco, mesmo corpo) e emita com `POST /v1/invoices` e uma `Idempotency-Key`, como na NF-e. O corpo não tem `natOp` nem endereço do destinatário, a não ser que a venda seja com entrega.",
      )),
      { kind: "code", language: "json", label: l("Request body", "Corpo da chamada"), code: NFCE_BODY },
      { kind: "code", language: "json", label: l("Answer 202", "Resposta 202"), code: NFCE_ACCEPTED },
      {
        kind: "table",
        head: [l("Field", "Campo"), l("What it is", "O que é")],
        rows: [
          ["`recipient`", l("Optional. The consumer may stay anonymous. `taxId` (CPF or CNPJ), `name` and `email` are all optional; with an e-mail the XML and the DANFCE are sent after the authorization (`sendEmail`).", "Opcional. O consumidor pode ficar sem identificação. `taxId` (CPF ou CNPJ), `name` e `email` são todos opcionais; com e-mail, o XML e o DANFCE são enviados depois da autorização (`sendEmail`).")],
          ["limit / `NFCE_CONSUMER_ID_REQUIRED`", l("From the limit of the state (R$ 10.000,00 by default, compared in cents: R$ 9.999,99 goes, R$ 10.000,00 needs the CPF or CNPJ) the identification is required.", "A partir do limite do estado (R$ 10.000,00 por padrão, comparado em centavos: R$ 9.999,99 passa, R$ 10.000,00 exige o CPF ou CNPJ) a identificação é obrigatória.")],
          ["`indPres`", l("How the sale happened: `1` in person at the store (default), `4` delivery, `5` in person outside the store. `4` needs the consumer `taxId`, `name` and `address`, otherwise `NFCE_DELIVERY_ADDRESS_REQUIRED` before any number is used.", "Como a venda aconteceu: `1` presencial na loja (padrão), `4` entrega em domicílio, `5` presencial fora da loja. O `4` exige `taxId`, `name` e `address` do consumidor, senão `NFCE_DELIVERY_ADDRESS_REQUIRED` antes de gastar número.")],
          ["`payments[].card`", l("Optional, only for `tPag` 03 (credit), 04 (debit) and 17 (Pix): `tpIntegra` (`1` integrated, `2` not, the default), `cnpj` of the card operator, `tBand` (brand, 2 digits) and `cAut` (authorization). Integrated needs `cnpj` and `cAut` (`NFCE_CARD_DATA_REQUIRED`). Another means with card data answers `NFCE_CARD_NOT_ALLOWED`.", "Opcional, só para `tPag` 03 (crédito), 04 (débito) e 17 (Pix): `tpIntegra` (`1` integrado, `2` não, o padrão), `cnpj` da operadora, `tBand` (bandeira, 2 dígitos) e `cAut` (autorização). Integrado exige `cnpj` e `cAut` (`NFCE_CARD_DATA_REQUIRED`). Outro meio com dados de cartão responde `NFCE_CARD_NOT_ALLOWED`.")],
        ],
      },
      heading(l("Read, QR Code and files", "Consultar, QR Code e arquivos")),
      { kind: "code", language: "json", label: "GET /v1/invoices/:id", code: NFCE_DOC },
      list([
        l("`qrCode` is the text of the QR Code printed on the DANFCE and `urlChave` is the page where the consumer looks the note up. Both come with the authorized note.", "`qrCode` é o texto do QR Code impresso no DANFCE e `urlChave` é a página onde o consumidor consulta a nota. Os dois vêm com a nota autorizada."),
        l("The **DANFCE** is the printed receipt: `GET /v1/invoices/:id/pdf` answers the cupom of **80 mm** and `GET /v1/invoices/:id/pdf?layout=a4` the same note on an A4 page. `GET /v1/invoices/:id/xml` answers the authorized XML and `POST /v1/invoices/:id/download-url` a temporary link.", "O **DANFCE** é o cupom impresso: `GET /v1/invoices/:id/pdf` responde o cupom de **80 mm** e `GET /v1/invoices/:id/pdf?layout=a4` a mesma nota numa página A4. `GET /v1/invoices/:id/xml` responde o XML autorizado e `POST /v1/invoices/:id/download-url` um link temporário."),
        l("In test mode the first item shows the text `NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL`, as the SEFAZ demands. Your saved item is not changed.", "Em teste, o primeiro item mostra o texto `NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL`, como a SEFAZ exige. O item que você guardou não muda."),
      ]),
      heading(l("Cancel, no correction letter, inutilize", "Cancelar, sem carta de correção, inutilizar")),
      list([
        l("**Cancel** with `POST /v1/invoices/:id/cancel` (justification of 15 to 255 characters). The NFC-e is meant to be cancelled **within 30 minutes** of the authorization; after that, the SEFAZ may refuse and the answer says so. Talk to your accountant in that case.", "**Cancele** com `POST /v1/invoices/:id/cancel` (justificativa de 15 a 255 caracteres). A NFC-e deve ser cancelada **em até 30 minutos** depois da autorização; passado o prazo, a SEFAZ pode recusar e a resposta diz isso. Nesse caso, fale com o seu contador."),
        l("**There is no correction letter (CC-e)** for the NFC-e: `POST /v1/invoices/:id/corrections` answers `422` `INVOICE_OPERATION_NOT_SUPPORTED`. Cancel it and issue another.", "**Não existe carta de correção (CC-e)** para a NFC-e: `POST /v1/invoices/:id/corrections` responde `422` `INVOICE_OPERATION_NOT_SUPPORTED`. Cancele e emita outra."),
        l("**Inutilize** numbers with `POST /v1/invoices/inutilizations` and `type: \"nfce\"`; the gaps are in `GET /v1/invoices/number-gaps?type=nfce`. In SP the suggestion stays on until the accountant confirms the rules of the state.", "**Inutilize** números com `POST /v1/invoices/inutilizations` e `type: \"nfce\"`; as lacunas estão em `GET /v1/invoices/number-gaps?type=nfce`. Em SP a sugestão continua valendo até o contador confirmar as regras do estado."),
        l("A rejected NFC-e is fixed with `PUT /v1/invoices/:id` (same number) or given up with `POST /v1/invoices/:id/discard`, like the NF-e.", "Uma NFC-e rejeitada se corrige com `PUT /v1/invoices/:id` (mesmo número) ou se descarta com `POST /v1/invoices/:id/discard`, como a NF-e."),
      ]),
      heading(l("Off-line NFC-e (contingency)", "NFC-e off-line (contingência)")),
      text(l(
        "When the SEFAZ cannot be reached, the sale at the counter cannot wait. In **off-line contingency** (`tpEmis` 9) Corvo numbers, signs and answers at once; the note is sent to the SEFAZ later, within **24 hours**.",
        "Quando a SEFAZ não responde, a venda no balcão não pode esperar. Na **contingência off-line** (`tpEmis` 9) a Corvo numera, assina e responde na hora; a nota é enviada à SEFAZ depois, em até **24 horas**.",
      )),
      list([
        l("**Ask for it** with `contingency: \"offline\"` in `POST /v1/invoices` (`type: \"nfce\"`). The answer is `201` (not `202`) with `{ type, id, status: \"contingency_pending\", accessKey, qrCode, xmlUrl, pdfUrl }`: the XML and the DANFCE (with the notice \"EMITIDA EM CONTINGÊNCIA\") are ready to hand over.", "**Peça** com `contingency: \"offline\"` em `POST /v1/invoices` (`type: \"nfce\"`). A resposta é `201` (e não `202`) com `{ type, id, status: \"contingency_pending\", accessKey, qrCode, xmlUrl, pdfUrl }`: o XML e o DANFCE (com o aviso \"EMITIDA EM CONTINGÊNCIA\") já podem ser entregues."),
        l("**Or let Corvo decide.** Each company has the option \"issue off-line automatically\" (`nfceAutoOffline` in `PUT /v1/companies/:id/nfe-settings`), **off by default**. When it is on and the SEFAZ cannot be reached, a request without `contingency` goes off-line by itself; when it is off, the NFC-e goes the normal way.", "**Ou deixe a Corvo decidir.** Cada empresa tem a opção \"emitir off-line automaticamente\" (`nfceAutoOffline` em `PUT /v1/companies/:id/nfe-settings`), **desligada por padrão**. Ligada, e com a SEFAZ fora do alcance, um pedido sem `contingency` sai off-line sozinho; desligada, a NFC-e segue o caminho normal."),
        l("**Transmission.** Corvo sends the very same signed XML as soon as the SEFAZ answers. After **20 hours** without success you get the webhook `nfce.contingency.deadline_near` (and an e-mail to the account owner, in production). After 24 hours it is still sent and the SEFAZ shows `cStat` 150 (authorized after the deadline).", "**Transmissão.** A Corvo envia o mesmo XML assinado assim que a SEFAZ responder. Depois de **20 horas** sem sucesso você recebe o webhook `nfce.contingency.deadline_near` (e um e-mail ao dono da conta, em produção). Depois de 24 horas ela ainda é enviada e a SEFAZ mostra o `cStat` 150 (autorizada fora do prazo)."),
        l("**Rejected afterwards.** The note is with the consumer already, so it keeps its number, series and key. `PUT /v1/invoices/:id` accepts only the description, barcode, NCM, CEST, unit and `additionalInfo`; any other change answers `422` `NFCE_CONTINGENCY_FIELD_LOCKED` with the paths in `details.fields`. If it cannot be fixed that way, talk to your accountant.", "**Rejeitada depois.** A nota já está com o consumidor, então mantém número, série e chave. `PUT /v1/invoices/:id` aceita só a descrição, o código de barras, o NCM, o CEST, a unidade e `additionalInfo`; qualquer outra mudança responde `422` `NFCE_CONTINGENCY_FIELD_LOCKED` com os caminhos em `details.fields`. Se não der para corrigir assim, fale com o seu contador."),
        l("Only states with a QR Code address in Corvo have it (`422` `NFCE_OFFLINE_NOT_AVAILABLE` otherwise). The QR Code of an off-line note carries the signature of the issuer (RSA SHA-1 with the A1).", "Só os estados com endereço de QR Code na Corvo têm essa opção (`422` `NFCE_OFFLINE_NOT_AVAILABLE` nos outros). O QR Code da nota off-line leva a assinatura do emitente (RSA SHA-1 com o A1)."),
      ]),
      heading(l("Errors of the NFC-e", "Erros da NFC-e")),
      {
        kind: "table",
        head: [l("Code", "Código"), l("Meaning", "Significado")],
        rows: [
          ["`NFCE_CONSUMER_ID_REQUIRED`", l("The total reached the limit of the state: give the consumer CPF or CNPJ.", "O total chegou ao limite do estado: informe o CPF ou CNPJ do consumidor.")],
          ["`NFCE_DELIVERY_ADDRESS_REQUIRED`", l("A delivery sale (`indPres` 4) needs the consumer id, name and address.", "A venda com entrega (`indPres` 4) exige identificação, nome e endereço do consumidor.")],
          ["`NFCE_IND_PRES_INVALID`", l("`indPres` must be 1, 4 or 5.", "`indPres` precisa ser 1, 4 ou 5.")],
          ["`NFCE_CARD_DATA_REQUIRED` · `NFCE_CARD_BRAND_INVALID` · `NFCE_CARD_NOT_ALLOWED`", l("Problems in the `card` data of a payment.", "Problemas nos dados de `card` de um pagamento.")],
          ["`NFCE_SCOPE_NOT_SUPPORTED`", l("Not supported yet: only a normal sale inside the state of the issuer.", "Ainda não suportado: só venda normal dentro do estado do emitente.")],
          ["`NFCE_OFFLINE_NOT_AVAILABLE`", l("The state of the company has no off-line NFC-e yet.", "O estado da empresa ainda não tem NFC-e off-line.")],
          ["`NFCE_CONTINGENCY_FIELD_LOCKED`", l("A correction of an off-line NFC-e changed a field that carries value (`details.fields`).", "Uma correção de NFC-e off-line mudou um campo que carrega valor (`details.fields`).")],
          ["`INVOICE_OPERATION_NOT_SUPPORTED`", l("For example, a correction letter on a NFC-e.", "Por exemplo, carta de correção numa NFC-e.")],
        ],
      },
      text(l(
        "The other codes (`NFE_VALIDATION_FAILED`, `COMPANY_NFE_INCOMPLETE`, `UF_NOT_ENABLED`, `NFE_PRODUCTION_DISABLED`, `IDEMPOTENCY_KEY_REUSED`...) are the ones of the NF-e: see NF-e: errors and hints.",
        "Os outros códigos (`NFE_VALIDATION_FAILED`, `COMPANY_NFE_INCOMPLETE`, `UF_NOT_ENABLED`, `NFE_PRODUCTION_DISABLED`, `IDEMPOTENCY_KEY_REUSED`...) são os da NF-e: veja NF-e: erros e dicas.",
      )),
      heading(l("Webhooks", "Webhooks")),
      text(l(
        "The NFC-e uses the same registration and signature as the other webhooks. The `data` carries `documentType: \"nfce\"` and `documentId`.",
        "A NFC-e usa o mesmo cadastro e a mesma assinatura dos outros webhooks. O `data` traz `documentType: \"nfce\"` e `documentId`.",
      )),
      {
        kind: "table",
        head: [l("Event", "Evento"), l("When", "Quando")],
        rows: [
          ["`nfce.document.authorized`", l("The SEFAZ authorized the note.", "A SEFAZ autorizou a nota.")],
          ["`nfce.document.rejected` · `nfce.document.denied`", l("The SEFAZ refused or denied it.", "A SEFAZ recusou ou denegou.")],
          ["`nfce.document.failed`", l("A failure that needs your look.", "Uma falha que precisa do seu olhar.")],
          ["`nfce.document.reconciliation_required` · `nfce.document.manual_review`", l("No answer, being checked; or the check could not confirm.", "Sem resposta, em conferência; ou a conferência não conseguiu confirmar.")],
          ["`nfce.document.cancelled` · `nfce.document.cancellation_rejected`", l("Cancellation registered or refused.", "Cancelamento registrado ou recusado.")],
          ["`nfce.document.documents_ready`", l("The XML and the DANFCE are ready.", "O XML e o DANFCE estão prontos.")],
          ["`nfce.document.email_sent` · `nfce.document.email_failed`", l("The e-mail to the consumer went or failed.", "O e-mail ao consumidor foi enviado ou falhou.")],
          ["`nfce.inutilization.completed` · `nfce.inutilization.rejected`", l("An inutilization was accepted or refused.", "Uma inutilização foi aceita ou recusada.")],
          ["`nfce.contingency.deadline_near`", l("An off-line NFC-e is 20 hours old and still was not transmitted (the limit is 24).", "Uma NFC-e off-line tem 20 horas e ainda não foi transmitida (o limite é 24).")],
        ],
      }
    ],
  };
}

/** The NF-e docs group: one builder for both languages. */
export function nfePages(locale: DocsLocale): Record<NfeSlug, DocSection> {
  return {
    nfe: overview(locale),
    "nfe-company": company(locale),
    "nfe-issue": issue(locale),
    "nfe-errors": errors(locale),
    "nfe-events": events(locale),
    "nfe-files": files(locale),
    nfce: nfce(locale),
  };
}
