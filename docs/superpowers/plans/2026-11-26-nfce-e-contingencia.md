# NFC-e (Fase 3) e contingência (Fase 4): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** somar a NFC-e (modelo 65, homologação primeiro) como mais um tipo de `/v1/invoices`, e depois a contingência: sondas por autoridade, NFC-e off-line, SVC automática da NF-e e proxy de reserva quando a nossa rede não alcança o governo.

**Arquitetura:** a NFC-e mora em `nfe_documents` com `model = 65` e reaproveita a máquina da NF-e (`modules/nfe`), que passa a ler o modelo do documento em vez de fixar 55. O que só existe na NFC-e (DTO, rotas `type: 'nfce'`, validadores, QR, DANFCE, registro do gateway) fica em `api/src/modules/nfce/`. A contingência junta três sinais que já existem (disjuntor por autoridade, monitor de alcance, status do serviço) numa leitura única (`FiscalSituationReader`) que o off-line, a SVC e o proxy consultam.

**Stack:** NestJS 11 + TypeORM/Postgres (RLS) + outbox, Jest; `undici` (mTLS, `ProxyAgent`), `xml-crypto`, `xmllint-wasm`, `fast-xml-builder`, `pdfkit`, `qrcode` (já são dependências do `api`). Web: Next.js 16 + next-intl + Vitest/RTL.

**Spec:** `docs/superpowers/specs/2026-11-26-nfce-e-contingencia-design.md`. Leia a spec inteira antes de qualquer tarefa; o plano cita seções dela ("spec 3.3.4"). O plano da NF-e (`docs/superpowers/plans/2026-11-26-nfe-fase-0-1.md`, commit `b7c000c`) mostra as convenções que este segue.

## Global Constraints

- **NFS-e e NF-e não mudam.** Nenhuma rota, status, webhook, coluna ou caminho S3 existente muda de nome ou formato; tudo é acréscimo (spec 6.1). Os specs atuais de NFS-e e NF-e passam **sem edição**, salvo quando a tarefa diz qual arquivo e por quê (ex.: um teste que fixava `model = 55` na constraint). `docs/openapi/openapi.json` só ganha itens.
- **Não calcular imposto.** Mesmos grupos zerados do Simples da NF-e (`ICMSSN102`, CSOSN 102/400, PIS/COFINS CST 49).
- **Homologação primeiro.** `NFE_PRODUCTION_ENABLED` também trava o modelo 65 (`NFE_PRODUCTION_DISABLED`). Uma UF só emite NFC-e com linha `(uf, 65, tp_amb)` em `nfe_enabled_authorities`, depois do roteiro de homologação. Produção liberada por UF, pelos mesmos portões.
- **Liberação da NFC-e:** `NFE_ENABLED` (env global que já existe) **e** `tenants.nfce_enabled_at IS NOT NULL`. Sem isso, `type: 'nfce'` responde 404 `RESOURCE_NOT_FOUND`, como a NF-e. Nenhuma env nova para a NFC-e.
- **Só QR Code v3, sem CSC** (spec 3.3.5). `nfce_csc_id`/`nfce_csc_encrypted` continuam vazios e intocados.
- **`infRespTec` por env:** reaproveita `NFE_RESP_TEC_CNPJ|CONTACT|EMAIL|PHONE` (já opcionais); sem as quatro, o grupo é omitido. Sem `idCSRT`/`hashCSRT`.
- **Fora do escopo:** EPEC (NF-e e NFC-e), ESC/POS, cancelamento por substituição (110112), FS-DA, CC-e na NFC-e (responde 422 `INVOICE_OPERATION_NOT_SUPPORTED`).
- **NFC-e off-line:** construída e **desligada por padrão**. O Corvo só decide sozinho quando a empresa ligou `nfce_auto_offline`; o pedido explícito `contingency: 'offline'` do PDV sempre vale.
- **Proxy de reserva:** só usado quando `FISCAL_HTTPS_PROXY` está definida **e** o monitor está em incidente `gov_unreachable_from_us`. Fora disso, rota direta. mTLS de ponta a ponta; allowlist de host exata.
- **SVC:** só documentos **nunca transmitidos** (`transmitted_at IS NULL` na tentativa atual). `reconciliation_required` nunca vai para a SVC (spec 4.2.2).
- **Inutilização em SP:** continua sendo sugerida (lacunas, número perdido) até o contador confirmar os Ajustes SINIEF 38/2026 e 40/2026. Nenhum código muda por isso; o runbook registra a pendência.
- **Segredos e LGPD:** certificado decifrado só em memória, por operação; nunca em log, job ou payload. Logs levam chave, cStat, UF, autoridade e duração; **nunca o XML inteiro**, CPF do consumidor, URL do proxy com credencial (usar `redactProxyUrl`).
- **CI (regras aprendidas):**
  - Nenhum teste pulado: `scripts/assert-no-skipped-tests.mjs` falha com `it.skip`/`describe.skip` ou spec Postgres sem `MIGRATION_TEST_DATABASE_URL`. Rode os `*.postgres.integration.spec.ts` com banco antes de dizer que a tarefa terminou.
  - Toda operação HTTP pública nova ou com parâmetro novo ganha caso em `api/test/openapi-contract.e2e-spec.ts`.
  - OpenAPI regenerado e commitado: `cd api && yarn openapi:generate`; `git diff --quiet -- docs/openapi web/public/openapi.json` precisa passar depois do commit.
  - Todo `code: '...'` literal novo na API ganha texto em `web/messages/pt.json` **e** `en.json` (`ApiErrors`) no mesmo PR (`web/tests/api-error-codes.test.ts`). Vale para códigos de validador (`issues[].code`).
  - Arquivo lido em runtime (XSD, fonte, tabela JSON) entra em `api/nest-cli.json` `assets`, em `api/scripts/verify-build-artifacts.mjs` e não pode ser excluído por `deploy/Dockerfile.api.dockerignore` (que exclui `**/*.pem` exceto a cadeia ICP).
  - Semgrep: nada de `new RegExp(<variável>)` (usar `includes`/`startsWith`/`Set`), nada de `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` ou `checkServerIdentity` que aceita tudo.
- **Fronteiras (já testadas em `fiscal-core.boundaries.spec.ts`):** `fiscal-core` não importa `modules/invoice`, `modules/nfe` nem `modules/nfce`; `modules/nfe/domain` e `modules/nfce/domain` não importam `@/infra/`; `infra/external/nfe/sefaz` não importa `@nestjs/`. Estender o spec para incluir `modules/nfce/domain` na Tarefa 1.
- **Migrações:** um arquivo por alteração em `api/src/infra/database/migrations/`, `down` simétrico. NFC-e usa `17936000000xx`; contingência usa `17937000000xx`. Constraints recriadas com o mesmo nome.
- **Git:** pilha de PRs, cada um partindo do branch do anterior. Atualizar com **merge, nunca rebase**; nunca `push --force`. Commits em pt-BR, convencionais (`feat(nfce): ...`, `feat(contingencia): ...`), terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ambiente:** yarn v1 (`yarn@1.22.22`), Node 24. API: `cd api && yarn jest <arquivo> [-t "<nome>"]`; Postgres: `MIGRATION_TEST_DATABASE_URL=postgresql://localhost/<db>_test`. Web: `cd web && yarn vitest run tests/<arquivo>`. Fim de cada tarefa: `yarn typecheck`, `yarn typecheck:tests` e `yarn lint:check` no pacote tocado.

## Review Focus

1. **NFC-e em homologação com o primeiro item com outra descrição.** Esperado: o builder troca o `xProd` do item 1 por `NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL` quando `tpAmb = 2` e `model = 65` (rejeição 373 **[verificar na homologação]**), sem mudar o item guardado nem a NF-e. Teste na Tarefa 6.
2. **Worker cai depois de abrir o disjuntor e antes do envio, e a UF entra na SVC.** Esperado: o documento com `transmitted_at` nulo sai com chave nova `tpEmis = 6/7` e a chave antiga vai para `nfe_document_history`; um documento com `transmitted_at` preenchido nunca muda de chave, espera a origem e segue a conciliação. Teste na Tarefa 34.
3. **NFC-e off-line transmitida, a resposta se perde, e o job reenvia.** Esperado: a segunda resposta é 204 (duplicidade); a conciliação consulta pela mesma chave e adota o protocolo; um único `nfce.document.authorized`. Teste na Tarefa 30.
4. **Proxy configurado e monitor em `ok`.** Esperado: nenhuma chamada passa pelo proxy; com o monitor em `gov_unreachable_from_us`, só hosts da allowlist usam o proxy, e um host fora dela vai direto. A URL do proxy nunca aparece em log sem `redactProxyUrl`. Teste na Tarefa 37.
5. **Consumidor sem identificação acima do limite da UF, e venda com `indPres = 4` sem endereço.** Esperado: `VALIDATION` com `NFCE_CONSUMER_ID_REQUIRED` (limite por UF, padrão R$ 10.000,00, comparado em centavos: R$ 9.999,99 passa, R$ 10.000,00 exige) e `NFCE_DELIVERY_ADDRESS_REQUIRED`, antes de numerar. Teste na Tarefa 8.

---

## Decisões do dono e do plano

Decisões do dono (perguntas da spec 10, respondidas):
1. **NFC-e off-line automática:** construída, desligada por padrão; cada empresa liga (`company_nfe_settings.nfce_auto_offline`, padrão `false`).
2. **Proxy de reserva:** construído; ligado só com `FISCAL_HTTPS_PROXY` definida **e** o monitor classificando `gov_unreachable_from_us`.
3. **Responsável técnico:** `infRespTec` configurável por env (as `NFE_RESP_TEC_*` que já existem); omitido quando não definido.
4. **Inutilização em SP:** continua sendo sugerida até o contador confirmar os Ajustes.
5. **EPEC** fora do escopo. **ESC/POS** fora do escopo.
6. **Homologação primeiro;** produção por UF atrás dos portões existentes (`NFE_PRODUCTION_ENABLED` + `nfe_enabled_authorities`).

Decisões do plano:
7. **Pilha e nomes.** A spec (9) propunha base `feat/nfe-07-dashboard-mcp-docs` e `fix/proxy-reserva-governo`; o plano usa base `docs/design-nfce-contingencia` (que já contém o PR #311 com toda a NF-e) e branches `feat/contingencia-04-proxy-reserva`. O item 10 da spec (EPEC) sai da pilha.
8. **Onde mora o código.** Máquina compartilhada (intake, emissão, conciliação, eventos, numeração, transições) fica em `modules/nfe` e passa a ler `doc.model`. O específico da NFC-e fica em `modules/nfce` (`NfceModule`, `NfceInvoiceRoutes`, DTO, validadores, QR, DANFCE). `NfeModule` exporta os serviços que o `NfceModule` usa.
9. **Rotas por modelo.** `NfeInvoiceRoutes.owns/list` passa a filtrar `model = 55` e `NfceInvoiceRoutes` filtra `model = 65`: uma chave de NF-e nunca enxerga uma NFC-e pelo id, e vice-versa. Permissões: as mesmas `nfe.*` (não há permissão nova).
10. **Série própria:** `company_nfe_settings.nfce_default_series smallint NOT NULL DEFAULT 1`.
11. **Disjuntor:** chave `nfce-<autoridade>-<tpAmb>` (`nfceBreakerAuthority`), separada da NF-e (`nfe-sp-2` ≠ `nfce-sp-2`). SVC: `nfe-svcan-<tpAmb>` e `nfe-svcrs-<tpAmb>`.
12. **Webhooks novos:** `nfce.document.{authorized,rejected,denied,failed,reconciliation_required,manual_review,documents_ready,email_sent,email_failed,cancelled,cancellation_rejected}`, `nfce.inutilization.{completed,rejected}`, `nfce.contingency.deadline_near`, `nfe.contingency.entered`, `nfe.contingency.exited`. Mesmo envelope do `FiscalWebhookPublisher` (`documentType: 'nfce'`).
13. **Estado da SVC é global, não da empresa.** Tabela nova `nfe_contingency_states (uf, tp_amb)` sem RLS (como `nfe_enabled_authorities`). A coluna `company_nfe_settings.contingency_mode` fica como está (reservada, sempre `'none'`).
14. **Prova de "nunca transmitido":** coluna `nfe_documents.transmitted_at`, gravada e commitada logo antes da chamada SOAP de autorização e zerada ao começar uma tentativa nova.
15. **Assinatura do QR off-line:** o algoritmo está no Manual do DANFE NFC-e e QR Code, não lido (spec 8). A Tarefa 26 é um portão: sem o algoritmo confirmado e um vetor de teste, a pilha de contingência para no PR 1/4.
16. **Correção de NFC-e off-line rejeitada:** só `items[].description`, `items[].gtin`, `items[].ncm`, `items[].cest`, `items[].unit` e `additionalInfo` podem mudar; qualquer outro campo diferente dá `NFCE_CONTINGENCY_FIELD_LOCKED`. Número, série, `cNF`, `dhEmi`, `tpEmis`, `dhCont` ficam: a chave é a mesma.
17. **Webhooks globais da SVC** vão para os tenants com NF-e liberada e ao menos uma empresa na UF, no ambiente do `tp_amb`; o operador recebe o e-mail de alerta já usado pelo monitor.
18. **DANFCE A4:** `GET /v1/invoices/{id}/pdf?layout=a4` (só NFC-e; `InvoiceRoutes.pdf` ganha `options: { layout?: 'a4' | '80mm' }`; NF-e e NFS-e ignoram).

## Pilha de PRs

| PR | Branch | Base | Tarefas |
|---|---|---|---|
| NFC-e 1/5 modelo 65 | `feat/nfce-01-model-65` | `docs/design-nfce-contingencia` | 1–4 |
| NFC-e 2/5 builder + QR | `feat/nfce-02-builder-qr` | `feat/nfce-01-model-65` | 5–9 |
| NFC-e 3/5 emitir/consultar/cancelar/inutilizar | `feat/nfce-03-emit` | `feat/nfce-02-builder-qr` | 10–14 |
| NFC-e 4/5 DANFCE | `feat/nfce-04-danfce` | `feat/nfce-03-emit` | 15–17 |
| NFC-e 5/5 web + MCP + docs | `feat/nfce-05-web-mcp-docs` | `feat/nfce-04-danfce` | 18–22 |
| Contingência 1/4 sondas | `feat/contingencia-01-sondas` | `feat/nfce-05-web-mcp-docs` | 23–25 |
| Contingência 2/4 NFC-e off-line | `feat/contingencia-02-nfce-offline` | `feat/contingencia-01-sondas` | 26–31 |
| Contingência 3/4 SVC | `feat/contingencia-03-svc` | `feat/contingencia-02-nfce-offline` | 32–35 |
| Contingência 4/4 proxy de reserva | `feat/contingencia-04-proxy-reserva` | `feat/contingencia-03-svc` | 36–37 |

**Mecânica:** `gh pr create --base <branch anterior>`. Quando o PR de baixo for mergeado: `gh pr edit <N> --base main`, `git merge origin/main` no branch N (sem rebase), `git push`. Mudança pedida num PR de baixo: commit nele e `git merge` em cada branch de cima. Cada PR verde sozinho: `yarn typecheck && yarn lint && yarn test` na raiz, os Postgres com banco, OpenAPI sem diff. Depois de aberto e enviado, `git worktree remove` da worktree do PR (conferir antes: nada sem commit, nada sem push).

---

## NFC-e 1/5, `feat/nfce-01-model-65`: o modelo 65 existe

**Objetivo:** `type: 'nfce'` conhecido pelo roteador, modelo 65 aceito nos dados, endpoints de SP do modelo 65, série e liberação por tenant. Nada emite ainda.

### Task 1: Tipo `nfce` no roteador e liberação por tenant

**Files:**
- Modify: `api/src/modules/fiscal-core/domain/invoice-type.ts`, `application/invoice-type.router.ts`, `application/nfe-access.policy.ts`, `domain/nfe-release.reader.ts`, `infra/typeorm-nfe-release.reader.ts`, `infra/typeorm-invoice-summaries.ts`
- Modify: `api/src/modules/invoice/http/invoice.controller.ts` (ramos `type === 'nfe'` passam a aceitar `'nfce'`), `invoice.dto.ts:300-460`
- Modify: `api/src/infra/persistence/typeorm/entities/tenant.orm-entity.ts`
- Create: `api/src/infra/database/migrations/1793600000000-AddTenantNfceEnabledAt.ts`
- Modify: `api/src/modules/fiscal-core/fiscal-core.boundaries.spec.ts` (incluir `modules/nfce/domain/**` na regra "domínio não importa infra")
- Test: `invoice-type.router.spec.ts`, `nfe-access.policy.spec.ts`

**Interfaces:**
- Produces: `INVOICE_TYPES = ['nfse', 'nfe', 'nfce']`, `INVOICE_LIST_TYPES = ['nfse', 'nfe', 'nfce', 'all']`.
- Produces: `NfeReleaseReader.releasedAt(tenantId: string, type: 'nfe' | 'nfce' = 'nfe'): Promise<Date | null>`; `NfeAccessPolicy.isEnabled(tenantId: string, type: 'nfe' | 'nfce' = 'nfe'): Promise<boolean>` com cache `nfe:enabled:<tenant>` (nfe, inalterado) e `nfce:enabled:<tenant>`.
- Produces: `InvoiceTypeRouter.byType` despacha `'nfe'` e `'nfce'` para `forType(type, ...)`; `forType` consulta `access.isEnabled(tenantId, type)`; `owner` só olha as rotas cujo tipo está liberado; `summaries` inclui `'nfce'` quando liberado. `InvoiceSummaryQuery.types` aceita `'nfce'` (`SELECT ... 'nfce' AS type ... WHERE model = 65`; o ramo `'nfe'` ganha `AND model = 55`).

- [ ] **Step 1: Testes que falham.** Router: `byType('nfce', ...)` sem rotas `nfce` registradas → 404 `RESOURCE_NOT_FOUND`; com rotas registradas e `isEnabled(t, 'nfce') = false` → 404; com `true` e sem permissão `nfe.invoices.create` → 403 `PERMISSION_DENIED`. Policy: `NFE_ENABLED=false` → `false` para os dois tipos; `nfe_enabled_at` setado e `nfce_enabled_at` nulo → `isEnabled(t,'nfe') = true`, `isEnabled(t,'nfce') = false`. O caso Postgres de summaries fica na Tarefa 2 (precisa da constraint nova).
- [ ] **Step 2:** `cd api && yarn jest src/modules/fiscal-core`. Esperado: FAIL.
- [ ] **Step 3:** Migração `tenants.nfce_enabled_at timestamptz NULL` (`down` remove). Implementar as interfaces acima. `GET /v1/invoices?type=nfce` sem rotas registradas responde 404 (o `IsIn` do DTO já aceita o valor).
- [ ] **Step 4:** Rodar o Step 2 + `yarn jest src/modules/invoice/http` + o Postgres com banco. Esperado: PASS; specs de NFS-e/NF-e sem edição.
- [ ] **Step 5:** `yarn openapi:generate` (o enum `type` ganha `nfce`), adicionar em `api/test/openapi-contract.e2e-spec.ts` o caso `GET /invoices?type=nfce answers 404 while NFC-e is not released`. Commit `feat(nfce): tipo nfce no roteador de /v1/invoices e liberação por tenant`.

### Task 2: Modelo 65 nos dados e nas rotas da NF-e

**Files:**
- Create: `api/src/infra/database/migrations/1793600000001-AllowNfceModel.ts` (troca `ck_nfe_documents_model`, `ck_nfe_number_sequences_model`, `ck_nfe_inutilizations_model` para `model IN (55, 65)`; `down` volta a `= 55` e falha se houver linha 65 — documentar no comentário)
- Modify: `api/src/modules/nfe/domain/nfe-document.ts` (`model: 55 | 65`; `CreateNfeDocumentParams.model?: 55 | 65`, padrão 55), `infra/nfe-document.mapper.ts`, `domain/nfe-document.repository.ts`, `infra/typeorm-nfe-document.repository.ts`
- Modify: `api/src/modules/nfe/http/nfe-invoice.routes.ts` (`owns`, `list`, `numberGaps`, `listInutilizations` filtram `model: 55`)
- Modify: `api/src/modules/nfe/infra/typeorm-nfe-number-gaps.query.ts`, `typeorm-nfe-inutilizations.ts` (filtro por modelo)
- Test: `api/src/modules/nfe/infra/typeorm-nfe-numbering.postgres.integration.spec.ts` (novo caso), `nfe-invoice.routes.spec.ts`, `api/src/modules/fiscal-core/infra/typeorm-invoice-summaries.postgres.integration.spec.ts`

**Interfaces:**
- Produces: `INfeDocumentRepository.findById(id, tenantId, environment, model?: 55 | 65)` e `list(query & { model: 55 | 65 })`; sem `model`, comportamento atual.
- Produces: `NfeNumberGapsQuery.gaps(scope & { model: 55 | 65 })`.

- [ ] **Step 1: Testes que falham.** Summaries (Postgres): um documento `model 55` e um `model 65` aparecem com `type` `nfe` e `nfce`, e `types: ['nfe']` não traz o 65. Postgres: `reserveNext({ model: 55, series: 1 })` e `reserveNext({ model: 65, series: 1 })` na mesma empresa devolvem `1` e `1` (sequências independentes). Routes: `owns(id)` de um documento `model 65` → `false` nas rotas da NF-e; `list` da NF-e não devolve o documento 65.
- [ ] **Step 2:** Rodar. Esperado: FAIL (constraint `model = 55`).
- [ ] **Step 3:** Migração + tipos + filtros. Onde o código da NF-e fixa `model: 55` em numeração/inutilização, ler o modelo do documento/escopo.
- [ ] **Step 4:** `yarn jest src/modules/nfe` (com banco). Esperado: PASS, specs da NF-e intocados.
- [ ] **Step 5:** Commit `feat(nfce): modelo 65 aceito em documentos, numeração e inutilização`.

### Task 3: Endpoints do modelo 65 e gateway por modelo

**Files:**
- Modify: `api/src/infra/external/nfe/sefaz/uf.ts` (`UfInfo.authorizer65: AuthorityId`), `endpoints.ts`, `nfe-gateway.ts`, `fake-nfe.gateway.ts`, `signed-nfe.ts`
- Modify: `api/src/modules/invoice/application/fiscal-portal-breaker.ts` (`nfceBreakerAuthority`)
- Modify: `api/src/modules/nfe/application/nfe-sefaz-access.ts` (`authorityOf(uf, model)`, `breakerAuthority(uf, env, model)`, `context(uf, env, cert, model)`)
- Test: `endpoints.spec.ts`, `nfe-gateway.contract.spec.ts`, `fake-nfe.gateway.contract.spec.ts`

**Interfaces:**
- Produces: `EndpointRow.model: 55 | 65`; helper `row65(...)` igual a `row` com `model: 65`. Linhas SP modelo 65, `tpAmb` 2 e 1, seis serviços, host `homologacao.nfce.fazenda.sp.gov.br` / `nfce.fazenda.sp.gov.br`, caminho `/ws/NFe<Serviço>4.asmx` **[verificar na página oficial de web services da NFC-e de SP antes do commit; o comentário de cada bloco cita a URL da fonte]**. `authorizer65`: `SP: 'SP'`; demais UFs `'SVRS'` com comentário **[não verificado; nenhuma linha SVRS 65 nesta pilha]**.
- Produces: `TableAuthorityEndpointResolver.resolve` usa `authorizer55` ou `authorizer65` conforme `q.model`.
- Produces: `new NfeGateway(soap, resolver, validator, timeoutMs, options?: { type?: 'nfe' | 'nfce'; model?: 55 | 65 }, clock?, sleep?)` — **o parâmetro `options` entra depois de `timeoutMs` e antes de `clock`; atualizar as chamadas existentes**. `call()` usa `options.model`. `asFiscalGateway()` devolve `type` do options e **omite `correct`** quando `type === 'nfce'`. `FakeNfeGateway` ganha `constructor(type: 'nfe' | 'nfce' = 'nfe')` com a mesma regra.
- Produces: `nfceBreakerAuthority(authority: AuthorityId, tpAmb: 1 | 2): string` → `nfce-${authority.toLowerCase()}-${tpAmb}`.

- [ ] **Step 1: Testes que falham.** `resolve({ uf: 'SP', tpAmb: 2, model: 65, tpEmis: 1, service: 'NfeAutorizacao' }).url` começa com `https://homologacao.nfce.fazenda.sp.gov.br/`; `resolve({ uf: 'RJ', model: 65, ... })` lança `AuthorityNotConfiguredError`; todas as linhas 65 têm host terminando em `.gov.br` e `soapAction` com `WSDL_NAMESPACE`; a resolução de modelo 55 continua igual (snapshot das 24 linhas atuais). Gateway: `new FakeNfeGateway('nfce').asFiscalGateway()` tem `type: 'nfce'` e `correct === undefined`; suíte `describeGatewayContract` roda também para o fake `nfce`. `nfceBreakerAuthority('SP', 2) === 'nfce-sp-2'`.
- [ ] **Step 2:** `yarn jest src/infra/external/nfe`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar + `yarn jest src/modules/nfe`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): endpoints SP do modelo 65 e gateway SEFAZ por modelo`.

### Task 4: Pré-condições e série da NFC-e

**Files:**
- Modify: `api/src/modules/fiscal-core/application/nfe-emission-preconditions.ts` (`model: 55 | 65`)
- Create: `api/src/infra/database/migrations/1793600000002-AddNfceDefaultSeries.ts`
- Modify: `api/src/modules/company/domain/nfe-settings.ts`, a entidade ORM e o mapper de `company_nfe_settings`, `company-nfe-settings.service.ts` e o DTO de configurações NF-e da empresa
- Test: `nfe-emission-preconditions.spec.ts` (casos novos), spec do serviço de configurações

**Interfaces:**
- Produces: `NfeSettings.nfceDefaultSeries: number` (0–999, padrão 1, `CHECK` igual ao de `default_series`); `NfeSettingsInput.nfceDefaultSeries?: number`; `NfeSettingsView` devolve o campo.
- Produces: `NfeEmissionPreconditions.check({ ..., model: 55 | 65 })`: mesma ordem; `UF_NOT_ENABLED` consulta `isEnabled(uf, model, tpAmb)`.

- [ ] **Step 1: Testes que falham.** `live` + `model: 65` + `NFE_PRODUCTION_ENABLED=false` → `NFE_PRODUCTION_DISABLED`; `test` + SP liberada só para 55 → `UF_NOT_ENABLED` com `details.uf = 'SP'` para 65; settings sem o campo devolvem `nfceDefaultSeries: 1`; `nfceDefaultSeries: 1000` → 400 de validação.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate` (campo novo nas configurações) e caso no contract e2e que lê/grava `nfceDefaultSeries`.
- [ ] **Step 4:** `yarn jest src/modules/fiscal-core src/modules/company` + e2e do contrato. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): série própria e pré-condições do modelo 65`. Abrir o PR NFC-e 1/5.

---

## NFC-e 2/5, `feat/nfce-02-builder-qr`: XML da NFC-e e dry-run

**Objetivo:** gerar o XML da NFC-e com `infNFeSupl` e QR v3 online, validar a entrada e responder `POST /v1/invoices/validate` com `type: 'nfce'`.

### Task 5: Entrada e rascunho da NFC-e

**Files:**
- Create: `api/src/modules/nfce/domain/nfce-input.ts`, `nfce-draft.ts` (+ `.spec.ts`)
- Modify: `api/src/modules/nfe/domain/nfe-draft.ts` (`model`, `recipient` nulo, `card`), `nfe-document.ts` (`recipient: NfeRecipient | null`), `infra/database` (migração abaixo)
- Create: `api/src/infra/database/migrations/1793600000003-AllowNfeDocumentWithoutRecipient.ts` (`recipient DROP NOT NULL` + `CHECK (model = 65 OR recipient IS NOT NULL)`)

**Interfaces:**
- Produces: `NfeDraft.model: 55 | 65` (`buildDraft` da NF-e devolve 55); `NfeDraft.recipient: NfeRecipient | null` (NF-e nunca nulo; validadores da NF-e tratam `null` como "nada a checar"); `NfeDraftPayment.card?: NfceCard`; `NfeRecipient.address` continua obrigatório quando há `recipient` com endereço — para a NFC-e, `NfceRecipient = Omit<NfeRecipient, 'address' | 'indIeDest'> & { indIeDest: 9; address: NfeAddress | null }` e o draft guarda `NfeRecipient` com `indIeDest: 9`.
- Produces: `NfceCard = { tpIntegra: 1 | 2; cnpj: string | null; tBand: string | null; cAut: string | null }`.
- Produces: `NfceInput = { companyId; recipient?: { taxId?: string; name?: string; email?: string; address?: NfeAddressInput }; indPres?: 1 | 4 | 5; items: NfeItemInput[]; payments: (NfePaymentInput & { card?: Partial<NfceCard> })[]; change?; additionalInfo?; externalId?; sendEmail? }` (camelCase, sem `natOp` obrigatório: padrão das configurações).
- Produces: `buildNfceDraft(input: NfceInput, issuer: NfeIssuer, settings, environment): NfeDraft` com `model: 65`, `tpImp: 4`, `indFinal: 1`, `idDest: 1`, `finNfe: 1`, `indPres: input.indPres ?? 1`; `card.tpIntegra` padrão `2`; sem `recipient` ou sem `taxId` → `recipient: null` quando também não há nome/endereço.

- [ ] **Step 1: Testes que falham** (`nfce-draft.spec.ts`): sem `recipient` → `draft.recipient === null`, `indPres === 1`, `tpImp === 4`, `idDest === 1`; `recipient: { taxId: '123.456.789-09' }` → `taxId '12345678909'`, `indIeDest 9`, `address null`; pagamento `{ tPag: '03', amount: 10, card: {} }` → `card.tpIntegra === 2`; `buildDraft` da NF-e devolve `model: 55` (spec existente intacto).
- [ ] **Step 2:** `yarn jest src/modules/nfce src/modules/nfe/domain`. Esperado: FAIL.
- [ ] **Step 3:** Implementar; ajustar o que o `tsc` apontar em `modules/nfe` só com guardas de `null` (sem mudar comportamento da NF-e).
- [ ] **Step 4:** Rodar + migração com banco. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): entrada e rascunho da NFC-e`.

### Task 6: Variações do builder por modelo

**Files:**
- Modify: `api/src/modules/nfe/domain/builder/ide.group.ts`, `dest.group.ts`, `det.group.ts`, `pag.group.ts`, `nfe-xml-builder.ts`, `context.ts`
- Create: `api/src/modules/nfe/domain/builder/__fixtures__/nfce-simples-102.xml`, entradas em `__fixtures__/inputs.ts`
- Test: `nfe-xml-builder.spec.ts` (casos 65), `nfce-builder.spec.ts`

**Interfaces:**
- Consumes: `NfeDraft.model`, `recipient | null`, `payments[].card` (Tarefa 5).
- Produces: `ideGroup` usa `mod: draft.model`; `buildAccessKey({ model: draft.model, ... })`.
- Produces: `destGroup(ctx)` → `undefined` quando `recipient === null`; para 65 com recipient: `CPF`/`CNPJ`, `xNome` só se houver nome (ou o nome fixo de homologação, ver Step 1), `enderDest` só se `address`, `indIEDest: 9`, sem `IE`.
- Produces: `detGroup(ctx)`: com `model 65` e `tpAmb 2`, `prod.xProd` do `nItem 1` = `NFCE_HOMOLOGATION_ITEM_DESCRIPTION = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'` (exportada de `context.ts`).
- Produces: `pagGroup(ctx)`: `detPag` ganha `card: { tpIntegra, CNPJ?, tBand?, cAut? }` quando `p.card` existe; ordem das tags conforme o XSD (`tpIntegra`, `CNPJ`, `tBand`, `cAut`).

- [ ] **Step 1: Testes que falham.** Build 65 sem recipient: XML sem `<dest>`, `<mod>65</mod>`, `<tpImp>4</tpImp>`, `<idDest>1</idDest>`, chave com `65` nas posições 21–22; homologação: primeiro `xProd` é o texto fixo e o segundo item mantém a descrição; recipient com CPF e homologação: `xNome` = `HOMOLOGATION_RECIPIENT_NAME` **[verificar na homologação]**; cartão: `<card><tpIntegra>2</tpIntegra></card>`; o XML 65 passa no `XmllintSchemaValidator` com schema `nfe` depois de `withStructuralSignature`. Builder 55: fixture `simples-102.xml` byte a byte igual.
- [ ] **Step 2:** `yarn jest src/modules/nfe/domain/builder`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): variações do builder para o modelo 65`.

### Task 7: QR Code v3 online, `urlChave` por UF e `infNFeSupl`

**Files:**
- Create: `api/src/modules/nfce/domain/nfce-qr-code.ts` (+ `.spec.ts`)
- Create: `api/src/infra/external/nfe/sefaz/nfce-urls.ts` (+ `.spec.ts`)
- Modify: `api/src/modules/nfe/domain/builder/nfe-xml-builder.ts` (`withSupplement`)

**Interfaces:**
- Produces: `NFCE_QR_VERSION = '3'`; `nfceQrCodeOnline(base: string, accessKey: string, tpAmb: 1 | 2): string` → `${base}?p=${accessKey}|3|${tpAmb}`. Lança se o resultado ficar fora de 60–1000 caracteres.
- Produces: `NfceUrls = { qrCode: string; urlChave: string }`; `NFCE_URLS: Partial<Record<Uf, Record<1 | 2, NfceUrls>>>`; `nfceUrlsFor(uf: Uf, tpAmb: 1 | 2): NfceUrls` (lança `AuthorityNotConfiguredError` sem linha). SP: homologação `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode` / `https://www.homologacao.nfce.fazenda.sp.gov.br/consulta`; produção `https://www.nfce.fazenda.sp.gov.br/qrcode` / `https://www.nfce.fazenda.sp.gov.br/consulta` **[não verificado: conferir no portal da NFC-e de SP e no ENCAT antes do commit; comentário com a fonte]**.
- Produces: `NfeXmlBuilder.withSupplement(supplement: { qrCodeBase: string; urlChave: string } | null)`; com `model 65`, `build()` exige o supplement e emite `<infNFeSupl><qrCode>…</qrCode><urlChave>…</urlChave></infNFeSupl>` como irmão depois de `<infNFe>`, sem CDATA. `BuiltDocument` ganha `qrCode?: string; urlChave?: string`.

- [ ] **Step 1: Testes que falham.** `nfceQrCodeOnline('https://x.gov.br/qrcode', KEY44, 2) === 'https://x.gov.br/qrcode?p=' + KEY44 + '|3|2'`; base vazia → lança. Tabela: toda linha de `nfe_enabled_authorities` que a seed de homologação traz com `model 65` tem URLs (teste percorre `ENDPOINTS` 65 e exige `nfceUrlsFor(uf, tpAmb)`); `urlChave.length` entre 21 e 85; host termina em `.gov.br`. Builder 65 sem `withSupplement` lança `NfeXmlBuilder: withSupplement() is required for model 65`; com supplement, a ordem dos filhos de `<NFe>` é `infNFe`, `infNFeSupl` e, depois de `SefazXmlSigner.sign`, `Signature`; o XSD passa.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar (o `&` do QR é escapado pelo `fast-xml-builder`; o separador `|` não é).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): QR Code v3 online e infNFeSupl com urlChave por UF`.

### Task 8: Validadores da NFC-e

**Files:**
- Create: `api/src/modules/nfce/domain/validators/{ind-pres,consumer-id,delivery-address,card,nfce-scope}.validator.ts`, `index.ts` (+ specs)
- Create: `api/src/modules/nfce/domain/consumer-limits.ts`
- Modify: `web/messages/pt.json`, `web/messages/en.json` (`ApiErrors`)

**Interfaces:**
- Produces: `NFCE_PRE_SEND_VALIDATORS: PreSendValidator<NfeDraft>[]` = validadores da NF-e que valem para a NFC-e (`text-charset`, `ncm`, `csosn`, `payments-total`, `tax-id` quando há recipient) + os novos. Códigos (`ValidationIssue.code`):
  - `NFCE_IND_PRES_INVALID` (indPres ∉ {1,4,5}, campo `indPres`);
  - `NFCE_DELIVERY_ADDRESS_REQUIRED` (indPres 4 sem `recipient.taxId`, nome ou endereço; campo `recipient`);
  - `NFCE_CONSUMER_ID_REQUIRED` (`totals.vNF` em centavos ≥ limite da UF e sem `recipient.taxId`; campo `recipient.taxId`);
  - `NFCE_CARD_DATA_REQUIRED` (`tpIntegra 1` sem `cnpj` ou `cAut`; campo `payments[i].card`);
  - `NFCE_CARD_BRAND_INVALID` (`tBand` fora de `CARD_BRANDS`);
  - `NFCE_CARD_NOT_ALLOWED` (`card` com `tPag` ∉ {03, 04, 17});
  - `NFCE_NO_PAYMENT_AMOUNT` (`tPag 90` com `vPag ≠ 0`);
  - `NFCE_SCOPE_NOT_SUPPORTED` (transporte, `finNfe ≠ 1` ou destinatário de outra UF; campo correspondente).
- Produces: `CONSUMER_ID_LIMIT_CENTS: Partial<Record<Uf, number>>` (vazio) e `consumerIdLimitCents(uf): number` com padrão `1_000_000`; `CARD_BRANDS = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','99']` **[não verificado: conferir a tabela tBand da NT vigente]**.

- [ ] **Step 1: Testes que falham** (um spec por validador, mais o Review Focus 5): vNF R$ 9.999,99 sem CPF → sem issue; R$ 10.000,00 sem CPF → `NFCE_CONSUMER_ID_REQUIRED`; indPres 4 sem endereço → `NFCE_DELIVERY_ADDRESS_REQUIRED`; indPres 2 → `NFCE_IND_PRES_INVALID`; card `tpIntegra 1` sem `cAut` → `NFCE_CARD_DATA_REQUIRED`; `tPag 90` com 1,00 → `NFCE_NO_PAYMENT_AMOUNT`; soma dos pagamentos menor que vNF → `PAYMENTS_TOTAL_MISMATCH` (reuso). `runValidators` devolve todos os problemas juntos.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; textos pt/en de cada código novo.
- [ ] **Step 4:** `yarn jest src/modules/nfce` e `cd web && yarn vitest run tests/api-error-codes.test.ts`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): validadores de consumidor, presença e pagamento`.

### Task 9: `NfceModule`, DTO e `POST /v1/invoices/validate` com `type: 'nfce'`

**Files:**
- Create: `api/src/modules/nfce/nfce.module.ts`, `http/nfce.dto.ts`, `http/nfce-invoice.routes.ts`, `application/nfce-preparation.service.ts`, `application/nfce-validate.service.ts` (+ specs)
- Modify: `api/src/app.module.ts` e o módulo do worker (importar `NfceModule`), `api/src/modules/nfe/nfe.module.ts` (exportar `NfeSefazAccess`, `NfeValidateService` helpers, `INfeDocumentRepository`, `TypeormNfeNumbering`, `NFE_SCHEMA_VALIDATOR`)
- Modify: `api/src/infra/openapi/public-schemas.ts` (schema `NfceRequest` no `oneOf` do validate/create)
- Test: `api/test/nfce-validate.e2e-spec.ts`, `api/test/openapi-contract.e2e-spec.ts`

**Interfaces:**
- Consumes: Tarefas 5–8; `NfePreparation` como modelo (a NFC-e chama `preconditions.check({ model: 65 })`, `buildNfceDraft`, `NFCE_PRE_SEND_VALIDATORS`).
- Produces: `NfceRequestDto` (class-validator; `recipient?`, `indPres?` `IsIn([1,4,5])`, `payments[].card?`, recusa `transport`, `finNfe ≠ 1`).
- Produces: `class NfceInvoiceRoutes implements InvoiceRoutes` com `type = 'nfce'`, registrada no `InvoiceTypeRouter` em `onModuleInit`; `owns` filtra `model 65`; `validate(body, includeXml, call)` → `{ valid: true, accessKeyPreview, xml? }` ou 422 `NFE_VALIDATION_FAILED` com `issues`. Os demais métodos respondem `invoiceOperationNotSupported('NFC-e emission is not available yet')` até a Tarefa 14 (o mesmo 422 que já existe).

- [ ] **Step 1: Testes que falham.** e2e: tenant com NFC-e liberada, `POST /v1/invoices/validate { type: 'nfce', companyId, items, payments }` → 200 `valid: true`, `accessKeyPreview` com `65` no modelo; com `includeXml=true`, o XML contém `<infNFeSupl>`; sem liberação → 404; R$ 10.000 sem CPF → 422 com `NFCE_CONSUMER_ID_REQUIRED`; `POST /v1/invoices { type: 'nfce' }` → 422 `INVOICE_OPERATION_NOT_SUPPORTED`. Contract: caso `POST /invoices/validate with type=nfce answers 200 with { data }`.
- [ ] **Step 2:** `yarn jest --config test/jest-e2e.json test/nfce-validate.e2e-spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate`.
- [ ] **Step 4:** Rodar e2e + contract + `git diff --quiet -- docs/openapi web/public/openapi.json` depois do commit. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): módulo NFC-e e dry-run em /v1/invoices/validate`. Abrir o PR NFC-e 2/5.

---

## NFC-e 3/5, `feat/nfce-03-emit`: emitir, consultar, cancelar, inutilizar

**Objetivo:** a NFC-e sai de verdade (homologação de SP), com a mesma máquina da NF-e lendo o modelo do documento.

### Task 10: Colunas do QR e webhooks `nfce.*`

**Files:**
- Create: `api/src/infra/database/migrations/1793610000000-AddNfceSupplementColumns.ts` (`qr_code text NULL`, `url_chave varchar(85) NULL`)
- Modify: `api/src/modules/nfe/infra/nfe-document.orm-entity.ts`, `nfe-document.mapper.ts`, `domain/nfe-document.ts` (`qrCode`, `urlChave`; `startAttempt(cNf, key, signedXml, issuedAt, supplement?: { qrCode: string; urlChave: string })`)
- Modify: `api/src/modules/webhooks-config/domain/webhook-event.ts`, `api/src/infra/openapi/public-schemas.ts` (enum de eventos)
- Test: `webhook-event.spec.ts` (caso novo: os eventos `nfce.*` são só acréscimo), mapper spec

**Interfaces:**
- Produces: eventos da decisão 12, menos os de contingência (entram nas Tarefas 30 e 33).
- Produces: `nfeEventName(model: 55 | 65, suffix: string): WebhookEvent['type']` em `modules/nfe/application/nfe-transition.service.ts` (`nfe.document.x` ou `nfce.document.x`); `FiscalWebhookPublisher.publish` recebe `ref.type` `'nfce'` para modelo 65.

- [ ] **Step 1: Testes que falham.** `nfeEventName(65, 'document.authorized') === 'nfce.document.authorized'`; a lista pública de eventos contém os `nfce.*` e mantém todos os antigos na mesma ordem; o mapper lê/grava `qr_code`/`url_chave`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate`.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): colunas do QR e eventos de webhook da NFC-e`.

### Task 11: Gateway NFC-e registrado

**Files:**
- Modify: `api/src/modules/nfce/nfce.module.ts` (`OnModuleInit` registra `nfce`), `api/src/modules/nfe/testing/nfe-stack.ts` (opção `model` para os testes de pilha)
- Test: `api/src/modules/nfce/nfce.module.spec.ts`

**Interfaces:**
- Consumes: `NfeGateway(..., { type: 'nfce', model: 65 })` e `FakeNfeGateway('nfce')` (Tarefa 3).
- Produces: com `NFE_TEST_PROVIDER=fake`, `registry.get('nfce')` é o fake; senão, o SOAP com `NFE_SEFAZ_TIMEOUT_MS`. `registry.get('nfce').correct === undefined`.

- [ ] **Step 1:** Teste: módulo iniciado com `fake` registra `nfce`; registrar duas vezes não lança (mesma guarda `has` do `NfeModule`).
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): gateway da NFC-e no registro fiscal`.

### Task 12: Emissão parametrizada pelo modelo

**Files:**
- Modify: `api/src/modules/nfe/application/nfe-intake.service.ts`, `nfe-emit.handler.ts`, `nfe-outcome.service.ts`, `nfe-transition.service.ts`, `nfe-draft-mapper.ts` (rascunho a partir do documento com `model`/`card`/`recipient null`)
- Create: `api/src/modules/nfce/application/nfce-intake.service.ts` (entrada → `NfeIntakeService.submit` com `model: 65`)
- Test: `api/src/modules/nfce/application/nfce-emit.postgres.integration.spec.ts`

**Interfaces:**
- Consumes: `access.authorityOf/breakerAuthority/context(..., model)`, `nfceUrlsFor`, `withSupplement`, `settings.nfceDefaultSeries`, `registry.get(model === 65 ? 'nfce' : 'nfe')`.
- Produces: `NfeIntakeService.submit(tenantId, environment, prepared, idempotencyKey, requestHash, model: 55 | 65 = 55)`; o documento nasce com `model`; o crédito usa `priceOf(model === 65 ? 'nfce' : 'nfe')` (semente `nfce = 1` já existe).
- Produces: `NfeEmitHandler.process` lê `doc.model` para numeração (série `nfceDefaultSeries` no 65), builder (`withSupplement(nfceUrls)` no 65), gateway e disjuntor; grava `qrCode`/`urlChave` no `startAttempt`. NF-e: mesmo caminho de antes (o argumento padrão é 55).

- [ ] **Step 1: Teste que falha** (Postgres + fake): NFC-e sem destinatário criada com `Idempotency-Key` → `queued` → emit → `authorized`, `qr_code` começa com a base de SP homologação e termina em `|3|2`, `number = 1`, série = `nfceDefaultSeries`; webhook enfileirado `nfce.document.authorized` com `documentType: 'nfce'`; uma NF-e na mesma empresa continua com `number = 1` (sequência própria) e `nfe.document.authorized`. Disjuntor aberto em `nfce-sp-2` → `retry_pending`, sem tocar `nfe-sp-2`.
- [ ] **Step 2:** Rodar com banco. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `yarn jest src/modules/nfe src/modules/nfce` com banco. Esperado: PASS; specs da NF-e sem edição.
- [ ] **Step 5:** Commit `feat(nfce): emissão da NFC-e pela máquina da NF-e`.

### Task 13: Consulta, conciliação, cancelamento e inutilização no modelo 65

**Files:**
- Modify: `api/src/modules/nfe/application/nfe-consult.service.ts`, `nfe-reconcile.handler.ts`, `nfe-event-context.ts`, `nfe-event-sender.ts`, `nfe-cancel.service.ts`, `nfe-inutilize.service.ts`, `nfe-inutilize.handler.ts`, `nfe-messages.ts`
- Test: `api/src/modules/nfce/application/nfce-events.postgres.integration.spec.ts`

**Interfaces:**
- Produces: todos os serviços escolhem gateway, contexto e disjuntor pelo `doc.model` (ou `inutilization.model`). `InutilizeRequest` já leva série; o builder `inut-nfe.builder.ts` já aceita `model`.
- Produces: `cancellationHint(model: 55 | 65, cStat: string): string | undefined` em `nfe-messages.ts`: para `65` e cStat `501` → `'A NFC-e só pode ser cancelada em até 30 minutos depois da autorização. Depois disso, fale com o contador.'` **[cStat 501 a verificar na homologação]**; o `GatewayOutcome.rejected.hint` leva o texto.
- Produces: `correct` para NFC-e não chega aqui (a rota responde 422 na Tarefa 14).

- [ ] **Step 1: Teste que falha** (Postgres + fake): NFC-e autorizada → cancelar → `cancelled` e `nfce.document.cancelled`; fake configurado para rejeitar com 501 → `cancellation_rejected` e `lastError.hint` com "30 minutos"; inutilizar série da NFC-e 5–7 → `nfe_inutilizations.model = 65` e `nfce.inutilization.completed`; conciliação de NFC-e em `reconciliation_required` consulta o gateway `nfce`.
- [ ] **Step 2:** Rodar com banco. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): consulta, cancelamento (dica dos 30 min) e inutilização`.

### Task 14: Rotas completas da NFC-e e contrato

**Files:**
- Modify: `api/src/modules/nfce/http/nfce-invoice.routes.ts` (todos os métodos), `api/src/modules/nfe/http/nfe-response.dto.ts` (`toNfeResponse` devolve `type: doc.model === 65 ? 'nfce' : 'nfe'`, `qrCode`, `urlChave`)
- Modify: `api/src/infra/openapi/public-schemas.ts`, `public-operations.ts`
- Test: `api/test/nfce.e2e-spec.ts`, `api/test/openapi-contract.e2e-spec.ts`

**Interfaces:**
- Produces: `NfceInvoiceRoutes` delega aos mesmos serviços da NF-e com `model: 65`; `correct` → `invoiceOperationNotSupported('NFC-e has no correction letter (Ajuste SINIEF 19/2016, cláusula 8ª)')`; `create` exige `Idempotency-Key` (`IDEMPOTENCY_KEY_REQUIRED`); `list` aceita só `status`, `companyId`, `limit`, `cursor` (`rejectNfseOnlyFilters(query, 'nfce')`).

- [ ] **Step 1: Testes que falham.** e2e: `POST /v1/invoices { type: 'nfce' }` → 202 `{ data: { type: 'nfce', id, status: 'queued' } }`; `GET /v1/invoices/{id}` → `type: 'nfce'`, `qrCode`, `urlChave`; `GET /v1/invoices?type=nfce` lista só modelo 65; `type=all` traz os dois; `POST /v1/invoices/{id}/corrections` de NFC-e → 422 `INVOICE_OPERATION_NOT_SUPPORTED`; cancel, inutilizations e number-gaps com `type=nfce`. Contract: um `it` por operação pública que ganhou `type=nfce`.
- [ ] **Step 2:** Rodar e2e. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate`.
- [ ] **Step 4:** Rodar e2e + contract; OpenAPI sem diff. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): rotas da NFC-e em /v1/invoices`. Abrir o PR NFC-e 3/5.

---

## NFC-e 4/5, `feat/nfce-04-danfce`: DANFCE

**Objetivo:** PDF de 80 mm (altura variável) e opção A4, com QR em JS puro, no mesmo fluxo de documentos da NF-e.

### Task 15: Modelo de visualização do DANFCE

**Files:**
- Create: `api/src/modules/nfce/infra/danfce/danfce-view.ts` (+ `danfce.spec.ts`), `__fixtures__/nfce-proc-simples.xml`

**Interfaces:**
- Produces: `toDanfceView(xml: string, opts: { homologation: boolean; cancelled?: boolean }): DanfceView` com `issuer { name, cnpj, address }`, `items[] { code, description, quantity, unit, unitPrice, total }`, `totals { count, vProd, vDesc, vNF, vTroco }`, `payments[] { label, amount }`, `consult { urlChave, accessKeyGroups: string }` (chave em grupos de 4), `consumer: string` (`'CONSUMIDOR NÃO IDENTIFICADO'` sem `dest`; CPF mascarado `***.456.789-**` com `dest`), `ident { number, series, issuedAt, protocol, authorizedAt }`, `qrCode`, `messages: string[]` (homologação: `'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL'`; `tpEmis 9`: `'EMITIDA EM CONTINGÊNCIA'` e `'Pendente de autorização'` sem protocolo).
- Aceita `nfeProc` (autorizada) e `NFe` sem protocolo (contingência, Tarefa 29).

- [ ] **Step 1: Testes que falham**: fixture sem `dest` → `consumer === 'CONSUMIDOR NÃO IDENTIFICADO'`; chave em 11 grupos de 4; `tPag 03` → `'Cartão de Crédito'`; homologação → mensagem fixa.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar (reusar formatadores de `danfe-view.ts` exportando-os, sem mudar a saída da NF-e).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): modelo de visualização do DANFCE`.

### Task 16: Renderer 80 mm e A4

**Files:**
- Create: `api/src/modules/nfce/infra/danfce/danfce-renderer.ts`, `qr-matrix.ts` (+ specs)
- Modify: `api/src/modules/fiscal-core/application/invoice-routes.ts` (`pdf(id, call, res, options?: { layout?: 'a4' | '80mm' })`), `api/src/modules/invoice/http/invoice.controller.ts` (lê `layout` da query e repassa), `nfce-invoice.routes.ts`
- Modify: `api/scripts/verify-build-artifacts.mjs` só se a DANFCE ler um arquivo novo (fontes da DANFSe já estão listadas)

**Interfaces:**
- Produces: `class DanfceRenderer implements DocumentRenderer` (`type = 'nfce'`); `render(xml, opts: RenderOptions & { layout?: 'a4' | '80mm'; cancelled?: boolean })`. 80 mm = 226,77 pt de largura, margem 8 pt, altura calculada a partir do conteúdo (uma página só); A4 = mesmo conteúdo centralizado numa coluna de 80 mm, quebrando página quando precisar.
- Produces: `qrMatrix(text: string): boolean[][]` via `QRCode.create(text, { errorCorrectionLevel: 'M' })` do pacote `qrcode`, desenhado com retângulos do `pdfkit` (sem PNG, sem módulo nativo).

- [ ] **Step 1: Testes que falham** (mesmo estilo de `danfe.spec.ts`, por texto extraído): `%PDF-`; 80 mm: largura da página 226,77 e 1 página com 60 itens; texto contém a chave agrupada, `CONSUMIDOR NÃO IDENTIFICADO`, `Consulte pela Chave de Acesso em`, a `urlChave`, número/série/protocolo; `layout: 'a4'` → página 595,28 × 841,89; `qrMatrix(qr)` tem lado ≥ 21 e é determinístico. Contract: `GET /invoices/{id}/pdf?layout=a4` de NFC-e → 200 `application/pdf`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate` (parâmetro `layout`).
- [ ] **Step 4:** Rodar + contract. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): DANFCE em 80 mm e A4 com QR em JS puro`.

### Task 17: DANFCE no fluxo de documentos e e-mail

**Files:**
- Modify: `api/src/modules/nfe/application/nfe-prepare-documents.handler.ts`, `nfe-files.service.ts`, `nfe-email.service.ts`, `nfe.tokens.ts` (`NFCE_DANFCE_RENDERER`), `nfce.module.ts`
- Test: `api/src/modules/nfce/application/nfce-documents.postgres.integration.spec.ts`

**Interfaces:**
- Produces: o handler escolhe o renderer por `doc.model`; arquivo `danfce.pdf` (NF-e continua `danfe.pdf`) em `.../nfe/<id>/`; `nfce.document.documents_ready`; e-mail ao consumidor só quando há `recipient.email` (assunto "Sua NFC-e").

- [ ] **Step 1:** Teste: NFC-e autorizada → `documents_ready_at` preenchido, objeto `danfce.pdf` no storage fake, `GET .../pdf` devolve o arquivo; sem e-mail → nenhum envio e nenhum `email_failed`.
- [ ] **Step 2:** Rodar com banco. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(nfce): DANFCE guardado e enviado ao consumidor`. Abrir o PR NFC-e 4/5.

---

## NFC-e 5/5, `feat/nfce-05-web-mcp-docs`: painel, MCP e docs

### Task 18: Liberação da NFC-e no admin da plataforma

**Files:**
- Modify: `api/src/modules/platform-admin/application/platform-nfe-access.service.ts`, `platform-admin.contract.ts`, o controller do admin, `infra/platform-admin-audit.repository.ts` (ação `nfce_access_set`)
- Modify: `web/components/admin/nfe-access-button.tsx`, `web/lib/platform-admin.ts`, `web/messages/{pt,en}.json`
- Test: `platform-nfe-access.service.spec.ts`, `web/tests/admin-nfe-access.test.tsx`

**Interfaces:**
- Produces: `PlatformNfeAccessService.set(tenantId: string, enabled: boolean, actor, type: 'nfe' | 'nfce' = 'nfe')` grava `nfce_enabled_at`, audita e limpa o cache `nfce:enabled:<tenant>`. Detalhe do usuário mostra `nfceEnabledAt`.

- [ ] **Step 1:** Testes: `set(t, true, actor, 'nfce')` grava a coluna e o evento de auditoria na mesma transação; o botão web tem dois toggles (NF-e, NFC-e) e chama a rota com `type`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(admin): liberar NFC-e por cliente`.

### Task 19: Lista e detalhe com o modelo

**Files:**
- Modify: `web/lib/nfe.ts` (`type?: 'nfe' | 'nfce'` em `NfeListQuery`; `NfeDocument.type`, `qrCode`, `urlChave`; `getNfePdf(id, layout?)`), `web/app/(dashboard)/app/nfe/page.tsx`, `web/app/(dashboard)/app/nfe/[id]/page.tsx`, `web/messages/{pt,en}.json`
- Test: `web/tests/nfe-list.test.tsx`, `web/tests/nfe-detail.test.tsx`

**Interfaces:**
- Produces: filtro "Modelo" (`Todos | NF-e | NFC-e`) que envia `type=nfe|nfce` (Todos = `type=all` restrito aos dois); coluna "Modelo"; detalhe de NFC-e sem o botão "Carta de correção", com "Baixar DANFCE" e "Baixar em A4", QR e link da consulta.

- [ ] **Step 1:** Testes RTL: mudar o filtro para NFC-e chama `listNfe` com `type: 'nfce'`; detalhe `type: 'nfce'` não renderiza o botão de correção e renderiza os dois downloads.
- [ ] **Step 2:** `cd web && yarn vitest run tests/nfe-list.test.tsx tests/nfe-detail.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar + `yarn typecheck`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(web): NFC-e na lista e no detalhe`.

### Task 20: Formulário "venda ao consumidor"

**Files:**
- Modify: `web/components/nfe/nfe-form.tsx`, `web/lib/nfe-form.ts`, `web/lib/nfe.ts` (`createNfce`, `validateNfce`, `NfceCreateInput`), `web/app/(dashboard)/app/nfe/new/page.tsx`, `web/components/companies/nfe-settings-form.tsx` (`nfceDefaultSeries`), mensagens
- Test: `web/tests/nfe-form.test.tsx`, `web/tests/nfe-settings-form.test.tsx`

**Interfaces:**
- Produces: seletor no topo do formulário (`NF-e` | `Venda ao consumidor (NFC-e)`), visível só com NFC-e liberada; no modo NFC-e: destinatário opcional (CPF/CNPJ, nome, e-mail), `indPres` (Presencial, Entrega em domicílio, Presencial fora do estabelecimento), cartão opcional por pagamento (`tBand`, `cAut`, CNPJ da credenciadora); depois de emitir, link "Baixar DANFCE".

- [ ] **Step 1:** Testes: modo NFC-e sem destinatário envia `createNfce` sem `recipient`; `indPres 4` exige endereço antes de enviar (mensagem local); configurações salvam `nfceDefaultSeries`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(web): emissão de NFC-e no modo venda ao consumidor`.

### Task 21: MCP com `type: 'nfce'`

**Files:**
- Modify: `api/src/modules/mcp/tools/nfe.tools.ts`, `tools/nfe-access.ts`, `tools/public-shapes.ts`, `mcp.service.ts:540-550`
- Test: `api/src/modules/mcp/tools/nfe.tools.spec.ts`, `api/test/nfe-mcp.e2e-spec.ts`

**Interfaces:**
- Produces: `INVOICE_TYPES = ['nfse', 'nfe', 'nfce']` (MCP) e descrições atualizadas ("nfce": venda ao consumidor, modelo 65, homologação); `nfe_validate` aceita `type: 'nfe' | 'nfce'`; `nfe_correct` com uma NFC-e devolve o erro `INVOICE_OPERATION_NOT_SUPPORTED`; `nfe_inutilize` e `nfe_number_gaps` aceitam `model: 55 | 65` (padrão 55); `nfe_settings_*` leem/gravam `nfce_default_series`. Nenhuma ferramenta nova.

- [ ] **Step 1:** Testes: emitir NFC-e pelo MCP (`invoice` tool com `type: 'nfce'`) → id; `nfe_correct` nela → erro; lista com `type: 'all'` traz NF-e e NFC-e.
- [ ] **Step 2:** Rodar spec + e2e. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(mcp): ferramentas fiscais aceitam NFC-e`.

### Task 22: Docs públicas, changelog e runbook

**Files:**
- Modify: `web/lib/docs/content/pt.ts`, `en.ts`, `web/lib/docs/nfe-pages.ts`, `docs/openapi/CHANGELOG.md`, `CHANGELOG.md`
- Create: `docs/fiscal/runbooks/nfce-homologacao.md`
- Test: `web/tests/docs-nfe.test.ts`

**Interfaces:**
- Produces: página "NFC-e" (pt/en): quando usar, `type: 'nfce'`, consumidor opcional e limite de R$ 10.000, `indPres`, cartão, QR v3 sem CSC, cancelamento em 30 min, sem CC-e, DANFCE 80 mm e `?layout=a4`, webhooks `nfce.*`. Runbook: credenciamento da IE em SP, SQL para liberar (`UPDATE tenants SET nfce_enabled_at = now()` e `INSERT INTO nfe_enabled_authorities (uf, model, tp_amb) VALUES ('SP', 65, 2)`), roteiro de homologação (autorizar, consultar, cancelar dentro e fora de 30 min, inutilizar), o que conferir nos itens **[verificar na homologação]** deste plano, a pendência da inutilização em SP (decisão 4) e a segunda UF (SVRS) sem linha até ter fonte oficial.

- [ ] **Step 1:** Teste: a navegação de docs tem a página NFC-e nas duas línguas e os exemplos JSON são válidos (mesmo padrão de `docs-nfe.test.ts`).
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Escrever.
- [ ] **Step 4:** Rodar + `cd web && yarn typecheck`. Esperado: PASS.
- [ ] **Step 5:** Commit `docs(nfce): documentação pública e runbook de homologação`. Abrir o PR NFC-e 5/5.

---

## Contingência 1/4, `feat/contingencia-01-sondas`: sondas por autoridade

**Objetivo:** saber, por autoridade, se a SEFAZ responde, e juntar isso ao disjuntor e ao monitor numa leitura única (spec 4.1).

### Task 23: Sondas TCP por autoridade

**Files:**
- Create: `api/src/modules/portal-reachability/authority-hosts.ts` (+ `.spec.ts`)
- Modify: `reachability.classifier.ts`, `portal-reachability.monitor.ts`, `portal-reachability.module.ts`
- Test: `reachability.classifier.spec.ts` (casos novos; os atuais intactos), `portal-reachability.monitor.spec.ts`

**Interfaces:**
- Produces: `authorityHosts(rows: EndpointRow[], enabled: { uf: Uf; model: 55 | 65; tpAmb: 1 | 2 }[]): { authority: string; host: string }[]` — para cada combinação liberada, o host (`new URL(url).hostname`) da linha `NfeStatusServico` da autoridade (`nfe-sp-2`, `nfce-sp-2`; na Tarefa 32 entram `nfe-svcan-2`/`nfe-svcrs-2`), sem duplicatas.
- Produces: `ProbeResults.authorities?: Record<string, boolean>`; `classifyProbes`: `ok` quando `sefin && adn` (inalterado); `portal_down` quando `sefin || adn || govControl || algum authorities = true`; senão `gov_unreachable_from_us`/`no_internet` como hoje.

- [ ] **Step 1: Testes que falham.** `authorityHosts` com SP 55 e 65 em homologação → dois hosts distintos; classifier: `{ sefin: false, adn: false, govControl: false, externalControl: true, authorities: { 'nfe-sp-2': true } }` → `portal_down`; todos os casos existentes dão o mesmo resultado sem `authorities`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; o monitor lê `nfe_enabled_authorities` (repositório do fiscal-core) e sonda em paralelo com `probeTcp`.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): sondas TCP por autoridade SEFAZ`.

### Task 24: Estado por autoridade e status público

**Files:**
- Create: `api/src/modules/portal-reachability/authority-reachability.store.ts` (+ spec)
- Create: `api/src/modules/portal-reachability/portal-reachability-read.module.ts` (store + leitor, importável por API e worker)
- Modify: `api/src/modules/invoice/http/invoice-review.controller.ts` (`portalStatus`), `api/src/infra/openapi/public-schemas.ts`
- Test: `invoice-review.controller.spec.ts`, `api/test/openapi-contract.e2e-spec.ts`

**Interfaces:**
- Produces: `AuthorityReachabilityStore.save(results: Record<string, boolean>, at: Date)` (Redis hash `ops:fiscal-authority-reachability`, TTL 10 min); `get(authority: string): Promise<{ reachable: boolean; checkedAt: string } | null>`; `all(): Promise<{ authority: string; reachable: boolean; checkedAt: string }[]>`.
- Produces: `GET /v1/fiscal-portal/status` ganha `connection.authorities: { authority, reachable, checkedAt }[]` (acréscimo; o resto igual).

- [ ] **Step 1:** Testes: depois de `save({ 'nfe-sp-2': false })`, `get('nfe-sp-2')` → `reachable: false`; Redis fora → `connection.authorities = []` sem 500; contract: o campo existe e é lista.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate`.
- [ ] **Step 4:** Rodar + contract. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): alcance por autoridade no status do portal`.

### Task 25: Leitura única da situação fiscal

**Files:**
- Create: `api/src/modules/fiscal-core/domain/fiscal-situation.ts` (+ spec)
- Create: `api/src/modules/portal-reachability/fiscal-situation.reader.ts` (+ spec)

**Interfaces:**
- Produces (fiscal-core, puro): `FiscalSituation = { breakerOpen: boolean; authorityReachable: boolean | null; network: PortalHealth }` (o tipo `PortalHealth` é copiado como união literal no fiscal-core, para não importar `portal-reachability`); `ContingencyAdvice = 'normal' | 'authority_down' | 'our_network' | 'no_internet'`; `adviseContingency(s: FiscalSituation): ContingencyAdvice` — `no_internet` se `network === 'no_internet'`; `our_network` se `network === 'gov_unreachable_from_us'`; `authority_down` se `breakerOpen || authorityReachable === false`; senão `normal`. `FISCAL_SITUATION_READER` + `FiscalSituationReader.situation(q: { authority: string; environment: ExecutionEnvironment }): Promise<FiscalSituation>`.
- Produces: `FiscalSituationReaderImpl` (breaker `status` + `AuthorityReachabilityStore.get` + `PortalReachabilityStore.current`); qualquer leitura que falhar vira o valor neutro (`false`, `null`, `'ok'`).

- [ ] **Step 1:** Testes de tabela para `adviseContingency` (os 4 resultados e a precedência `no_internet` > `our_network` > `authority_down`); reader com Redis falhando → `normal`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar + boundaries spec. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): leitura única de disjuntor, sonda e monitor`. Abrir o PR Contingência 1/4.

---

## Contingência 2/4, `feat/contingencia-02-nfce-offline`: NFC-e off-line

**Objetivo:** com o pedido do PDV (ou a opção da empresa ligada e a autoridade fora), emitir na hora com `tpEmis = 9`, transmitir depois e avisar antes do prazo de 24 h (spec 4.3).

### Task 26: Portão — assinatura do QR off-line

**Files:**
- Create: `docs/fiscal/nfce-qrcode.md` (algoritmo, fonte, versão do manual, vetor de teste)
- Create: `api/src/modules/nfce/domain/nfce-qr-code-offline.ts` (+ spec), `api/src/infra/external/nfe/sefaz/qr-signer.ts` (+ spec)

**Interfaces:**
- Produces: `nfceQrCodeOffline(base: string, p: { accessKey: string; tpAmb: 1 | 2; day: string; vNF: string; destIdType: '' | '1' | '2' | '3'; destId: string }, signature: string): string` → `${base}?p=${key}|3|${tpAmb}|${day}|${vNF}|${destIdType}|${destId}|${signature}` (campos e formatos exatamente como no manual).
- Produces: `QrPayloadSigner.sign(payload: string, certificate: LoadedCertificate): string` (algoritmo do manual; `node:crypto` com a chave PEM em memória).

- [ ] **Step 1:** Ler o "Manual de Padrões Técnicos do DANFE NFC-e e QR Code" vigente (Portal NF-e / ENCAT). Registrar em `docs/fiscal/nfce-qrcode.md`: quais campos entram na assinatura, ordem, hash, codificação (base64?), formato de `dia` e `vNF`, e um vetor de teste oficial (ou gerado e validado na homologação de SP). **Se o algoritmo não puder ser confirmado, parar aqui e avisar o dono: as Tarefas 27–31 não começam.**
- [ ] **Step 2:** Testes com o vetor: `nfceQrCodeOffline(...)` igual ao texto esperado; `QrPayloadSigner.sign` com o certificado de teste (`certificate-loader.spec.ts` tem um) reproduz a assinatura do vetor ou verifica com a chave pública.
- [ ] **Step 3:** Rodar. Esperado: FAIL.
- [ ] **Step 4:** Implementar. Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): QR Code v3 off-line assinado com o A1`.

### Task 27: Estado `contingency_pending`, colunas e opção da empresa

**Files:**
- Create: `api/src/infra/database/migrations/1793700000000-AddNfeContingencyColumns.ts` (status `contingency_pending` em `ck_nfe_documents_status`; `contingency_at timestamptz NULL`, `contingency_reason varchar(256) NULL`, `contingency_alerted_at timestamptz NULL`, `transmitted_at timestamptz NULL`; índice parcial `idx_nfe_documents_contingency ON (contingency_at) WHERE status = 'contingency_pending'`)
- Create: `api/src/infra/database/migrations/1793700000001-AddNfceAutoOffline.ts` (`company_nfe_settings.nfce_auto_offline boolean NOT NULL DEFAULT false`)
- Modify: `api/src/modules/nfe/domain/nfe-status.ts`, `nfe-document.ts`, ORM/mapper, `nfe-settings.ts` + DTO/serviço de configurações, `web/lib/nfe.ts` (`NFE_STATUSES`), `web/components/nfe/nfe-status-badge.tsx`, mensagens
- Test: `nfe-status.spec.ts`, `nfe-document.spec.ts`

**Interfaces:**
- Produces: `NfeStatus` ganha `'contingency_pending'`; `NFE_VALID_TRANSITIONS.contingency_pending = ['processing']`; `processing` continua com os destinos de hoje. `NfeDocument.createOffline(params & { model: 65; contingencyAt: Date; contingencyReason: string })` nasce em `contingency_pending`; `NfeDocument.markContingencyAlerted(at: Date)`; `NfeDocument.markTransmitted(at: Date)` e `startAttempt` zera `transmittedAt` (decisão 14; a NF-e passa a gravá-lo na Tarefa 34).
- Produces: `NfeSettings.nfceAutoOffline: boolean` (padrão `false`).

- [ ] **Step 1:** Testes: `contingency_pending → processing` permitido, `→ authorized` direto proibido (`InvalidNfeTransitionError`); NF-e (55) nunca nasce em `contingency_pending` (`createOffline` com 55 lança); settings sem o campo → `false`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate` (status e campo novos).
- [ ] **Step 4:** Rodar + migrações com banco + web badge test. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): estado contingency_pending e opção de off-line automática`.

### Task 28: Builder com `tpEmis`, `dhCont` e `xJust`

**Files:**
- Modify: `api/src/modules/nfe/domain/builder/nfe-xml-builder.ts`, `context.ts`, `ide.group.ts`
- Test: `nfe-xml-builder.spec.ts`

**Interfaces:**
- Produces: `NfeXmlBuilder.withContingency(c: { tpEmis: 6 | 7 | 9; dhCont: string; xJust: string } | null)`; `ide.tpEmis = c?.tpEmis ?? 1`; `dhCont` e `xJust` (15–256 caracteres) no fim de `ide`, na ordem do XSD; a chave usa o mesmo `tpEmis`. `withSupplement` passa a aceitar `{ qrCode: string; urlChave: string }` pronto (o QR off-line é montado fora, com a assinatura da Tarefa 26).

- [ ] **Step 1:** Testes: com `tpEmis 9`, chave com `9` na posição 35 (índice 34) e `<dhCont>`/`<xJust>` presentes; sem contingência, XML da NF-e byte a byte igual à fixture; `xJust` com 14 caracteres lança.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar + XSD. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): builder com tpEmis de contingência`.

### Task 29: Emissão off-line síncrona

**Files:**
- Create: `api/src/modules/nfce/application/nfce-offline.service.ts` (+ Postgres spec)
- Modify: `api/src/modules/nfce/http/nfce.dto.ts` (`contingency?: 'offline'`), `nfce-invoice.routes.ts` (`create` decide o caminho), `nfce-intake.service.ts`, `danfce-renderer.ts` (aceita `NFe` sem protocolo)
- Modify: `web/messages/{pt,en}.json` (códigos novos)
- Test: `api/test/nfce-offline.e2e-spec.ts`, contract

**Interfaces:**
- Consumes: `FiscalSituationReader`/`adviseContingency` (Tarefa 25), `QrPayloadSigner`, `nfceQrCodeOffline`, `withContingency`, `NfeDocument.createOffline`.
- Produces: `NfceOfflineService.emit(tenantId, environment, prepared, idempotencyKey, requestHash, reason: string): Promise<NfeDocument>` — numa transação: reserva número, monta (`tpEmis 9`, `dhCont = agora no fuso da UF`, `xJust = reason`), assina, gera QR off-line, grava em `contingency_pending` com `transmitted_at NULL`, enfileira `nfce.transmit` no outbox. Fora da transação, renderiza o DANFCE com "EMITIDA EM CONTINGÊNCIA" e guarda.
- Produces: regra de `create`: `contingency: 'offline'` → off-line sempre; sem o campo e `settings.nfceAutoOffline` e `adviseContingency(...) !== 'normal'` → off-line com `xJust` `'SEFAZ indisponivel'` (`authority_down`) ou `'Sem comunicacao com a SEFAZ'` (`our_network`/`no_internet`); senão o caminho normal. Resposta `201` com `{ data: { type: 'nfce', id, status: 'contingency_pending', accessKey, qrCode, xmlUrl, pdfUrl } }`.
- Produces: `contingency: 'offline'` em ambiente sem off-line permitido para a UF (sem `NFCE_URLS`) → 422 `NFCE_OFFLINE_NOT_AVAILABLE`.

- [ ] **Step 1: Testes que falham.** e2e: `POST { type: 'nfce', contingency: 'offline' }` → 201, `status: 'contingency_pending'`, chave com `9`, `GET .../pdf` contém "EMITIDA EM CONTINGÊNCIA"; empresa com `nfceAutoOffline=false` e disjuntor aberto → 202 `queued` (caminho normal); com `true` → 201 off-line; mesma `Idempotency-Key` repetida → mesmo `id`, sem número novo. Contract: caso 201 do off-line.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate`; textos de `NFCE_OFFLINE_NOT_AVAILABLE`.
- [ ] **Step 4:** Rodar e2e + Postgres + contract. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): NFC-e off-line emitida na hora com tpEmis 9`.

### Task 30: Transmissão, prazo de 24 h e alerta de 20 h

**Files:**
- Create: `api/src/modules/nfce/application/nfce-transmit.handler.ts`, `api/src/modules/nfce/jobs/nfce-contingency.scheduler.ts` (+ specs)
- Modify: `api/src/modules/webhooks-config/domain/webhook-event.ts` (`nfce.contingency.deadline_near`), `public-schemas.ts`, `nfe-email.service.ts` (e-mail ao dono da conta)
- Test: `api/src/modules/nfce/application/nfce-transmit.postgres.integration.spec.ts`

**Interfaces:**
- Produces: `NFCE_CONTINGENCY_ALERT_AFTER_MS = 20 * 3_600_000`, `NFCE_CONTINGENCY_DEADLINE_MS = 24 * 3_600_000`.
- Produces: `NfceTransmitHandler.handle({ documentId })`: sob lock, `contingency_pending → processing`, grava `transmitted_at`, envia o **mesmo** XML assinado; o resultado segue `NfeOutcomeService.settle` (100 e 150 = autorizada; 204 = conciliação pela chave; rejeição = `rejected` + `nfce.document.rejected`). Disjuntor aberto → volta a `contingency_pending` sem gastar tentativa (`attempt` igual).
- Produces: `NfceContingencyScheduler` (`@Cron('* * * * *')`, só no worker): reenfileira `nfce.transmit` para `contingency_pending` com disjuntor fechado; para cada um com `now - contingency_at ≥ 20 h` e `contingency_alerted_at IS NULL`, marca o alerta, envia e-mail e publica `nfce.contingency.deadline_near` com `{ accessKey, contingencyAt, deadlineAt }`. Depois de 24 h, continua transmitindo (o cStat 150 aparece no detalhe).

- [ ] **Step 1: Testes que falham** (relógio injetado): 19h59 → nenhum alerta; 20h00 → um alerta e um webhook; nova rodada → nenhum alerta repetido; fake devolve 150 → `authorized` com `cStat '150'`; Review Focus 3: primeira transmissão `uncertain`, segunda devolve 204 → consulta pela chave → `authorized` e um único `nfce.document.authorized`; disjuntor aberto → continua `contingency_pending`, `attempt` igual.
- [ ] **Step 2:** Rodar com banco. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate` (evento novo).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): transmissão da NFC-e off-line com alerta de 20 h`.

### Task 31: Correção da off-line rejeitada, configuração e docs

**Files:**
- Modify: `api/src/modules/nfe/application/nfe-resubmit.service.ts`, `api/src/modules/nfce/http/nfce-invoice.routes.ts` (`resubmit`), `web/components/companies/nfe-settings-form.tsx`, `web/app/(dashboard)/app/nfe/[id]/page.tsx` (selo e prazo), docs pt/en, `docs/fiscal/runbooks/nfce-homologacao.md` (seção contingência), mensagens
- Create: `api/src/modules/nfce/domain/offline-correction.ts` (+ spec)
- Test: `api/test/nfce-offline.e2e-spec.ts` (casos novos), `web/tests/nfe-settings-form.test.tsx`

**Interfaces:**
- Produces: `lockedFieldsChanged(before: NfeDocumentSnapshot, after: NfeDraft): string[]` — lista os caminhos que mudaram fora de `items[].description|gtin|ncm|cest|unit` e `additionalInfo`.
- Produces: `PUT /v1/invoices/{id}` (resubmit) de NFC-e rejeitada com `tp_emis 9`: campos travados mudaram → 422 `NFCE_CONTINGENCY_FIELD_LOCKED` com `details.fields`; senão reconstrói com o mesmo `cNF`, `dhEmi`, `dhCont`, `xJust`, série e número (mesma chave), assina de novo, volta a `contingency_pending` (transição nova `rejected → contingency_pending`, só para `tpEmis 9`) e enfileira `nfce.transmit`.
- Produces: toggle "Emitir em contingência off-line automaticamente" nas configurações (texto explica o risco da rejeição posterior).

- [ ] **Step 1:** Testes: mudar `items[0].unitPrice` → 422 `NFCE_CONTINGENCY_FIELD_LOCKED` com `fields: ['items[0].unitPrice']`; mudar só `description` → mesma `accessKey`, `contingency_pending`; toggle salva `nfceAutoOffline`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; textos pt/en do código novo; docs.
- [ ] **Step 4:** Rodar API e web. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): correção da NFC-e off-line rejeitada e opção no painel`. Abrir o PR Contingência 2/4.

---

## Contingência 3/4, `feat/contingencia-03-svc`: SVC-AN / SVC-RS automática na NF-e

**Objetivo:** com os três sinais da spec 4.2.1, a NF-e de uma UF passa para a SVC; só o que nunca foi transmitido muda de chave.

### Task 32: Endpoints e mapa da SVC

**Files:**
- Modify: `api/src/modules/fiscal-core/domain/ports/authority.port.ts` (`AuthorityId` ganha `'SVCAN' | 'SVCRS'`), `api/src/infra/external/nfe/sefaz/uf.ts` (`UfInfo.svc: 'SVCAN' | 'SVCRS'`), `endpoints.ts`, `api/src/modules/portal-reachability/authority-hosts.ts`
- Test: `endpoints.spec.ts`, `uf.spec.ts`

**Interfaces:**
- Produces: `svc` conforme o Ato COTEPE 39/2012 (spec fato 9): `SVCAN` para AC, AL, AP, CE, ES, MG, PA, PB, PI, RJ, RS, RN, RO, RR, SC, SE, SP, TO, DF; `SVCRS` para AM, BA, GO, MA, MT, MS, PE, PR.
- Produces: linhas `model 55`, `tpEmis 6` (SVCAN) e `7` (SVCRS), `tpAmb` 1 e 2, serviços `NfeAutorizacao`, `NfeRetAutorizacao`, `NfeConsultaProtocolo`, `NfeStatusServico`, `RecepcaoEvento` (**sem** `NfeInutilizacao`). Hosts: SVC-AN `hom.svc.fazenda.gov.br` / `www.svc.fazenda.gov.br`; SVC-RS `nfe-homologacao.svrs.rs.gov.br` / `nfe.svrs.rs.gov.br` **[não verificado: conferir no Portal NF-e e no MOC Anexo III; comentário com a fonte]**.
- Produces: `resolve` com `tpEmis 6|7` procura a autoridade `UF_TABLE[uf].svc` (e lança se o `tpEmis` não bate com o `svc` da UF); com `tpEmis 1|9`, `authorizer55/65` como hoje, procurando as linhas de `tpEmis 1` (a NFC-e off-line é transmitida ao autorizador normal; teste: `resolve({ uf: 'SP', model: 65, tpEmis: 9, ... })` devolve a mesma URL de `tpEmis 1`).
- Produces: `authorityHosts` inclui `nfe-svcan-<tpAmb>`/`nfe-svcrs-<tpAmb>` para as UFs 55 liberadas.

- [ ] **Step 1:** Testes: `resolve({ uf: 'SP', model: 55, tpEmis: 6, tpAmb: 2, service: 'NfeAutorizacao' }).authority === 'SVCAN'`; `tpEmis 7` para SP lança; `NfeInutilizacao` com `tpEmis 6` lança; as 27 UFs têm `svc`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): endpoints SVC-AN e SVC-RS`.

### Task 33: Estado da SVC por UF e a troca automática

**Files:**
- Create: `api/src/infra/database/migrations/1793710000000-CreateNfeContingencyStates.ts` (`nfe_contingency_states (uf char(2), tp_amb smallint, mode varchar(10) NOT NULL DEFAULT 'none' CHECK (mode IN ('none','svc')), entered_at timestamptz NULL, dh_cont varchar(25) NULL, x_just varchar(256) NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (uf, tp_amb))`, sem RLS)
- Create: `api/src/modules/nfe/infra/typeorm-nfe-contingency-states.ts`, `api/src/modules/nfe/jobs/nfe-svc-switch.scheduler.ts`, `api/src/modules/nfe/application/nfe-svc-switch.service.ts` (+ specs)
- Modify: `webhook-event.ts` + `public-schemas.ts` (`nfe.contingency.entered`, `nfe.contingency.exited`), `api/src/modules/platform-admin/**` + `web/components/admin/**` (botão "Sair da SVC" por UF)
- Test: `nfe-svc-switch.service.spec.ts`, Postgres do repositório

**Interfaces:**
- Produces: `NfeContingencyStates.get(uf, tpAmb): Promise<{ mode: 'none' | 'svc'; dhCont: string | null; xJust: string | null }>` e `set(uf, tpAmb, state)`.
- Produces: `NfeSvcSwitchService.evaluate(uf: Uf, tpAmb: 1 | 2, now: Date): Promise<'entered' | 'exited' | 'unchanged'>` — entra quando: disjuntor `nfe-<origem>-<tpAmb>` aberto **e** `network` não é `gov_unreachable_from_us`/`no_internet` **e** `serviceStatus` da SVC (`tpEmis 6|7`) responde 107; grava `mode 'svc'`, `dhCont` (fuso da UF), `xJust = 'SEFAZ de origem indisponivel'`. Sai quando o disjuntor da origem fecha **e** o status da origem responde 107. `forceExit(uf, tpAmb, actor)` para o botão do admin (auditado).
- Produces: entrada/saída publicam `nfe.contingency.entered|exited` (`{ uf, tpAmb, authority, dhCont }`) para os tenants da decisão 17 e enviam o e-mail de alerta do operador.
- Produces: `NfeSvcSwitchScheduler` (`@Cron('* * * * *')`, worker) chama `evaluate` para cada `(uf, 55, tp_amb)` liberado.

- [ ] **Step 1:** Testes de tabela com fakes (breaker, reader, gateway status): três sinais → `entered`; rede nossa fora → `unchanged`; SVC respondendo 108 → `unchanged`; em `svc`, origem fechada e 107 → `exited`; webhooks publicados uma vez por transição; `forceExit` grava auditoria.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; `yarn openapi:generate` (eventos novos).
- [ ] **Step 4:** Rodar + Postgres. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): entrada e saída automáticas da SVC por UF`.

### Task 34: Emissão na SVC só para o nunca transmitido

**Files:**
- Modify: `api/src/modules/nfe/application/nfe-emit.handler.ts` (passa a gravar `transmitted_at`, criado na Tarefa 27), `nfe-sefaz-access.ts` (`breakerAuthority`/`context` com `tpEmis`), `nfe-gateway.ts` (`call` usa o `tpEmis` do documento: `SignedNfe.tpEmis`), `signed-nfe.ts`
- Test: `api/src/modules/nfe/application/nfe-svc.postgres.integration.spec.ts`

**Interfaces:**
- Produces: `SignedNfe.tpEmis: TpEmis` (padrão 1); `tpEmisOfKey(key: string): TpEmis` (índice 34) em `access-key.ts`.
- Produces: `NfeEmitHandler`: depois de `breaker.assertAvailable` passar e antes da chamada SOAP, uma transação curta grava `transmitted_at = now()` (disjuntor que bloqueia não marca nada). Com a UF em `svc` e o documento `queued` ou `retry_pending` **com `transmitted_at IS NULL`**: nova tentativa (`attempt + 1`, chave antiga em `nfe_document_history`), mesmo número e série, builder `withContingency({ tpEmis: svc === 'SVCAN' ? 6 : 7, dhCont, xJust })`, disjuntor `nfe-svcan|svcrs-<tpAmb>`. `retry_pending` com `transmitted_at` preenchido, `processing` e `reconciliation_required` nunca trocam de chave.

- [ ] **Step 1: Testes que falham** (Review Focus 2): UF em `svc`, documento `queued` → autorizado com chave `tpEmis 6`, histórico com a chave antiga; documento em `retry_pending` com `transmitted_at` → continua com a chave `tpEmis 1` e espera; `reconciliation_required` → nunca vai à SVC; worker que morre entre `transmitted_at` e a resposta → reconciliação pela chave original.
- [ ] **Step 2:** Rodar com banco. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar `src/modules/nfe` inteiro com banco. Esperado: PASS; specs da NF-e sem edição.
- [ ] **Step 5:** Commit `feat(contingencia): NF-e nunca transmitida sai pela SVC com chave nova`.

### Task 35: Eventos, DANFE e docs da SVC

**Files:**
- Modify: `nfe-event-sender.ts`, `nfe-consult.service.ts` (consulta/eventos de nota `tpEmis 6|7` vão aos endpoints da SVC pela chave **[verificar na homologação: o MOC pode mandar para a origem]**), `danfe-view.ts` + `danfe-renderer.ts` (mensagem "EMITIDA EM CONTINGÊNCIA SVC" com `dhCont` e `xJust`), `web/app/(dashboard)/app/nfe/[id]/page.tsx` (selo), docs pt/en, `docs/fiscal/runbooks/nfe-svc.md` (novo)
- Test: `danfe.spec.ts` (caso novo), spec do event sender

**Interfaces:**
- Produces: `endpointTpEmis(key: string): TpEmis` decide o endpoint de consulta/evento (6|7 → SVC; demais → origem), isolado num só lugar para virar a outra regra se a homologação mandar.

- [ ] **Step 1:** Testes: cancelamento de nota com chave `tpEmis 6` resolve `SVCAN`; DANFE de nota `tpEmis 6` contém "CONTINGÊNCIA SVC"; DANFE de nota normal sem mudança.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; runbook (como confirmar a ativação pela SEFAZ de origem, como forçar a saída, o que verificar na homologação).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(contingencia): eventos e DANFE de NF-e emitida na SVC`. Abrir o PR Contingência 3/4.

---

## Contingência 4/4, `feat/contingencia-04-proxy-reserva`: saída de rede alternativa

**Objetivo:** reviver o PR #321 (`origin/fix/proxy-chamadas-governo`, commit `29fba0f`) com dois limites novos: só durante `gov_unreachable_from_us` e allowlist estendida às autoridades SEFAZ/SVC (spec 4.4.3).

### Task 36: Proxy de governo com allowlist exata

**Files:**
- Create (a partir de `git show 29fba0f:<caminho>`): `api/src/infra/external/fiscal-proxy/gov-proxy.ts` (+ `gov-proxy.spec.ts`, `gov-proxy.integration.spec.ts`), `scripts/gov-proxy/gov-proxy.mjs`
- Modify: `api/src/infra/config/env.schema.ts` (`FISCAL_HTTPS_PROXY`), `api/src/infra/config/fiscal-proxy-env.spec.ts` (novo, do PR antigo), `api/.env.example`, `SELF_HOSTING.md`

**Interfaces:**
- Produces: `FISCAL_HTTPS_PROXY: z.string().trim().url().refine((v) => v.startsWith('http://') || v.startsWith('https://'), 'must be an http(s) URL').optional()` (sem regex).
- Produces: `GOV_FISCAL_HOSTS: ReadonlySet<string>` = `sefin`/`adn` da NFS-e (produção e restrita, os hosts exatos que o `open-nfse` usa) ∪ `new URL(row.url).hostname` de todas as linhas de `ENDPOINTS`; `isGovFiscalHost(host: string): boolean` = `GOV_FISCAL_HOSTS.has(host.toLowerCase())`.
- Produces: `redactProxyUrl(raw: string): string` (do PR antigo); `buildGovProxyAgent(proxyUrl, pem: { keyPem; certPem }, ca?: string): ProxyAgent` com `requestTls { key, cert, ca, ALPNProtocols: ['http/1.1'] }` — nunca `rejectUnauthorized: false`; para a SEFAZ, `ca` é a cadeia ICP de `certs/icp-brasil-chain.pem` (a mesma do `SefazSoapClient`).
- Produces: `GovProxyDispatchers.for(key: string, pem, ca?)` com LRU de 32 (chave = hash do certificado, como no PR antigo).
- Produces: `gov-proxy.mjs` aceita CONNECT só para os hosts da allowlist (lista gerada do mesmo `ENDPOINTS` e escrita no runbook).

- [ ] **Step 1:** Testes: `isGovFiscalHost('nfe.fazenda.sp.gov.br')` verdadeiro, `'evil.gov.br.example.com'` falso, `'NFE.FAZENDA.SP.GOV.BR'` verdadeiro; `redactProxyUrl('http://u:p@h:3128') === 'http://***@h:3128'`; env inválida (`ftp://x`) falha; integração (servidor CONNECT local, como no PR antigo): o túnel abre só para host permitido e o certificado do cliente chega ao destino.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar + Semgrep local se disponível (`semgrep scan --config auto api/src/infra/external/fiscal-proxy`). Esperado: PASS, nenhum achado.
- [ ] **Step 5:** Commit `feat(contingencia): proxy de governo com allowlist de NFS-e e SEFAZ`.

### Task 37: Rota escolhida pelo monitor

**Files:**
- Create: `api/src/modules/portal-reachability/gov-route.selector.ts` (+ spec)
- Modify: `api/src/infra/external/nfse/open-nfse.provider.ts` (dispatcher por chamada, como no PR antigo, mas condicionado ao seletor), `api/src/infra/external/nfe/sefaz/soap-client.ts` (`SoapRequest.dispatcher?: Dispatcher`), `api/src/modules/nfe/application/nfe-sefaz-access.ts` / `nfe.module.ts` / `nfce.module.ts` (passar o dispatcher), `api/test/__mocks__/open-nfse.ts`
- Create: `docs/fiscal/runbooks/proxy-governo.md` (do PR antigo, atualizado)
- Test: `gov-route.selector.spec.ts`, `open-nfse.provider.proxy.spec.ts`, `soap-client.proxy.spec.ts`

**Interfaces:**
- Produces: `GovRouteSelector.useProxy(): Promise<boolean>` = `FISCAL_HTTPS_PROXY` definida **e** `PortalReachabilityStore.current()` com `state === 'gov_unreachable_from_us'`; resultado em cache por 15 s; erro do Redis → `false` (rota direta). Loga uma vez por mudança (`'Government calls now go through <redactProxyUrl>'` / `'... go direct again'`).
- Produces: `GovRouteSelector.dispatcherFor(host: string, pem, ca?): Promise<Dispatcher | undefined>` — `undefined` quando `useProxy()` é falso ou `!isGovFiscalHost(host)`.
- Produces: as sondas do monitor (`probeTcp`) **nunca** usam o proxy: elas medem a rota direta, e é isso que faz o Corvo voltar sozinho.

- [ ] **Step 1: Testes que falham** (Review Focus 4): sem env → `false` em qualquer estado; env + `ok` → `false`; env + `gov_unreachable_from_us` → `true`; env + `portal_down` → `false`; `dispatcherFor('example.com', ...)` → `undefined` mesmo em incidente; o `SefazSoapClient` usa o dispatcher recebido em vez do `Agent` mTLS cacheado e mantém o `Agent` direto fora do incidente; o log nunca contém a senha do proxy (`expect(logs).not.toContain('p@')`).
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar; runbook: subir o proxy **fora da Guara**, allowlist, variável, como testar (`curl -x` CONNECT), como saber que entrou (log + status do portal), custo, monitoramento próprio do proxy.
- [ ] **Step 4:** `yarn jest src/infra/external src/modules/portal-reachability src/modules/nfe src/modules/invoice`. Esperado: PASS; specs da NFS-e sem edição fora de `open-nfse.provider.proxy.spec.ts` (novo) e do mock.
- [ ] **Step 5:** Commit `feat(contingencia): proxy de reserva ligado só quando o governo some da nossa rede`. Abrir o PR Contingência 4/4.

---

## Self-review (feito)

- **Cobertura da spec:** 3.1 (reuso) Tarefas 2, 3, 12, 13; 3.2 Tarefa 2; 3.3.1–3.3.3 Tarefas 5, 6, 8; 3.3.4 Tarefa 7; 3.3.5 Global Constraints; 3.3.6 Tarefas 15–17; 3.3.7–3.3.9 Tarefa 13; 3.3.8 Tarefa 14; 3.3.10 Tarefa 3; 3.3.11 Tarefas 9, 14; 3.3.12 Tarefas 19–21; 3.4/3.5 Tarefa 22; 4.1 Tarefas 23–25; 4.2 Tarefas 32–35 (EPEC fora, decisão 5); 4.3 Tarefas 26–31; 4.4 Tarefas 36–37 (NF-e/NFS-e na fila já é o comportamento atual do disjuntor); 4.5 sem código; 6 Global Constraints; 7 runbooks. Pergunta 3 resolvida sem tarefa (`NFE_RESP_TEC_*` já omite o grupo); pergunta 4 só no runbook.
- **Tipos entre tarefas:** `model: 55 | 65` (Tarefas 2–14), `NfeGateway` options (3 → 11), `nfceBreakerAuthority` (3 → 12), `withSupplement` (7 → 12, ampliado em 28), `withContingency` (28 → 29, 34), `FiscalSituationReader`/`adviseContingency` (25 → 29, 33), `transmitted_at`/`markTransmitted` (criado na 27, gravado pela NFC-e na 30 e pela NF-e na 34), `isGovFiscalHost` (36 → 37).
- **Pontos não verificados que travam produção, não a homologação:** URLs do modelo 65 e do QR de SP, hosts da SVC, tabela `tBand`, cStat 501 da dica, regra de `xProd`/`xNome` em homologação, destino dos eventos de nota SVC. Cada um está marcado na tarefa dona e listado no runbook.
