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
        ],
      },
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
  };
}
