# Importação de notas por planilha (API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar um CSV/Excel, ler e validar as linhas em fila, permitir conferência paginada e emitir as notas aos poucos, com contadores ao vivo (aceitas, autorizadas, com erro).

**Architecture:** Novo módulo `import` no API, no padrão de `invoice-schedule`. Arquivo vai ao S3 e é lido por um job BullMQ que grava `import_rows`. A emissão chama `InvoiceBatchService.emitBatch` em pedaços de 50. Status e contadores vêm de agregação no banco. Sem SSE: a tela fará polling.

**Tech Stack:** NestJS, TypeORM (Postgres), BullMQ, `@aws-sdk/client-s3` (já instalado), `exceljs` e `csv-parse` (novos), Jest.

**Spec:** `docs/superpowers/specs/2026-11-07-spreadsheet-import-design.md`

## Global Constraints

- Até **2.000 linhas** e **10 MB** por arquivo; só `.csv` e `.xlsx`.
- Nenhuma resposta devolve todas as linhas: cursor, padrão 50, máximo 200. Contadores por agregação SQL. CSV de erros em fluxo.
- Arquivo só no S3 em `imports/<tenant>/<ambiente>/<importId>`, apagado após a leitura, ao descartar e por limpeza diária (> 24 h). Nunca entregue por link.
- Chave de idempotência por linha: `import:<importId>:<número da linha>`.
- `SCHEDULE` e `RECURRING` nunca entram. Linha com CNPJ diferente da empresa escolhida é rejeitada.
- Permissão `nfse.invoices.issue` e `ExecutionEnvironmentGuard`, como `POST /invoices`. Tudo isolado por tenant e ambiente.
- Erros sempre com códigos do catálogo (prefixo `ERROR_IMPORT_*` novos), nunca texto cru.
- Contadores: `accepted`, `authorized`, `failed` (erro de validação, rejeição ou nota rejeitada). Concluída (`done`) só quando nada está em processamento.
- Mesmo hash de arquivo (tenant, ambiente, empresa) só avisa (`duplicateOf` na resposta), nunca bloqueia.

## Review Focus

- Planilha com `;`, aspas, BOM ou Latin-1 (Excel brasileiro): deve ler sem trocar acentos.
- Valor `1.234,56`, `1234.56`, `R$ 1.234,56` e célula numérica do Excel: centavos exatos, nunca ponto flutuante.
- Arquivo vazio, só cabeçalho, 2.001 linhas, arquivo renomeado (`.csv` com bytes de xlsx): falha limpa, arquivo apagado do S3.
- Clique duplo em Emitir e reinício do processo no meio: nada emitido duas vezes.
- Créditos acabando no meio de um pedaço: as primeiras entram, as demais ficam rejeitadas por limite e reenviáveis.
- Importação de outro tenant ou outro ambiente: sempre 404.

---

### Task 1: Tabelas e repositório

**Files:**
- Create: `api/src/infra/database/migrations/<timestamp>-CreateImports.ts`
- Create: `api/src/modules/import/infra/import.orm-entity.ts`, `import-row.orm-entity.ts`, `typeorm-import.repository.ts`
- Create: `api/src/modules/import/domain/import.ts`, `import.repository.ts`
- Test: `typeorm-import.repository.postgres.integration.spec.ts`

**Interfaces:**
- Produces: `ImportStatus = 'processing' | 'ready' | 'emitting' | 'done' | 'failed'`; `ImportRowStatus = 'valid' | 'invalid' | 'queued' | 'accepted' | 'rejected'`.
- Produces: abstract `ImportRepository` com `create`, `findById(tenantId, env, id)`, `counters(tenantId, env, id): Promise<{total, valid, invalid, accepted, authorized, failed, pending}>`, `listRows(tenantId, env, id, {status?, cursor?, limit}): Promise<{items, nextCursor}>`, `updateRow`, `findByFileHash(tenantId, env, companyId|null, hash)`, `delete`.

- [ ] **Step 1:** Escrever o teste de integração: cria importação com 5 linhas de status variados e confere `counters` (inclui `authorized`, obtido por join com o status das notas) e `listRows` com `limit: 2` percorrendo todas as páginas sem repetir ou pular linha.
- [ ] **Step 2:** Rodar o teste; Expected: FAIL (módulo inexistente).
- [ ] **Step 3:** Migração e entidades: `imports` (id, tenant_id, environment, user_id, file_name, file_hash, status, company_id null, error_code null, emit_started_at null, emit_finished_at null, created_at) com índice (tenant_id, environment, created_at); `import_rows` (import_id, line, data jsonb, status, error_code null, error_message null, invoice_id null) com PK (import_id, line). `counters` por uma única consulta agregada.
- [ ] **Step 4:** Rodar o teste; Expected: PASS. Rodar `npm run build` no `api`; Expected: sem erro.
- [ ] **Step 5:** Commit `feat(api): tabelas e repositório de importações`.

### Task 2: Leitura e normalização (função pura)

**Files:**
- Create: `api/src/modules/import/domain/parse-spreadsheet.ts`, `normalize-row.ts`, `columns.ts`
- Test: `parse-spreadsheet.spec.ts`, `normalize-row.spec.ts`

**Interfaces:**
- Produces: `parseSpreadsheet(bytes: Buffer, kind: 'csv' | 'xlsx'): Promise<{ rows: Record<string, string>[]; unknownColumns: string[] }>` (lança `ImportError('ERROR_IMPORT_TOO_MANY_ROWS' | 'ERROR_IMPORT_EMPTY' | 'ERROR_IMPORT_UNREADABLE')`).
- Produces: `normalizeRow(raw: Record<string, string>): { item: Record<string, unknown>; cnpjPrestador?: string }` onde `item` tem o formato de `BatchInvoiceItemDto` (valor em reais com 2 casas, calculado a partir de centavos inteiros).

- [ ] **Step 1:** Escrever testes: CSV com `;`, BOM, Latin-1; cabeçalhos em português e inglês sem acento/caixa; `1.234,56`, `1234.56`, `R$ 1.234,56`, célula numérica do xlsx; documento com máscara; datas `dd/mm/aaaa` e `aaaa-mm-dd`; arquivo vazio, só cabeçalho e 2.001 linhas.
- [ ] **Step 2:** Rodar; Expected: FAIL.
- [ ] **Step 3:** Implementar com `csv-parse` e `exceljs` (adicionar ao `api/package.json`), lendo só valores. Detectar separador e codificação. Aliases de colunas em `columns.ts`.
- [ ] **Step 4:** Rodar; Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): leitura e normalização de planilhas`.

### Task 3: Armazenamento no S3

**Files:**
- Create: `api/src/modules/import/infra/import-file-storage.ts` (usa o mesmo cliente/bucket de `src/infra/storage`)
- Modify: `api/src/infra/storage/storage.module.ts` (exportar o necessário)
- Test: `import-file-storage.spec.ts`

**Interfaces:**
- Produces: `ImportFileStorage` com `save(tenantId, env, importId, bytes): Promise<void>`, `read(...): Promise<Buffer>`, `remove(...): Promise<void>` (remover algo inexistente não falha), `listOlderThan(hours): Promise<{key}[]>`.

- [ ] **Step 1:** Teste com cliente S3 simulado (padrão de `s3-storage.spec.ts`): chave exata `imports/<tenant>/<env>/<id>`, `remove` idempotente, `listOlderThan` filtra por data.
- [ ] **Step 2:** Rodar; Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar; Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): armazenamento temporário de planilhas no S3`.

### Task 4: Envio e leitura em fila

**Files:**
- Create: `api/src/modules/import/http/import.controller.ts` (`POST /imports`), `import.dto.ts`, `application/import-intake.service.ts`, `jobs/import-read.processor.ts`
- Create: `api/src/modules/import/import.module.ts`; Modify: `api/src/app.module.ts`
- Test: `import-intake.service.spec.ts`, `import-read.processor.spec.ts`, `import.controller.spec.ts`

**Interfaces:**
- Consumes: `parseSpreadsheet`, `normalizeRow`, `ImportRepository`, `ImportFileStorage`; `InvoiceService.prepareEmission` (validação sem gravar; se tiver efeito colateral, extrair um `validateEmission` puro).
- Produces: `POST /imports` (multipart `file`, `companyId?`) → 202 `{ data: { id, status: 'processing', duplicateOf?: string } }`; rejeita > 10 MB e extensão inválida com 400 no catálogo; rate limit como o lote.
- Produces: job `import-read` que grava `import_rows` (`valid`/`invalid`), resolve empresa por CNPJ ou empresa escolhida (conflito → linha inválida), usa os padrões da empresa para campos faltantes, vai a `ready` ou `failed`, e **sempre apaga o arquivo do S3**.

- [ ] **Step 1:** Testes: upload válido enfileira e responde 202; arquivo de 11 MB e `.pdf` → 400; processor grava linhas válidas e inválidas com código do catálogo; CNPJ diferente da empresa escolhida → linha inválida; arquivo com 2.001 linhas → `failed` com `ERROR_IMPORT_TOO_MANY_ROWS` e arquivo removido; `.csv` com bytes de xlsx → `failed`; `duplicateOf` quando o hash repete.
- [ ] **Step 2:** Rodar; Expected: FAIL.
- [ ] **Step 3:** Implementar seguindo o padrão do módulo `invoice-schedule` (módulo, guardas, decoradores de permissão e Swagger).
- [ ] **Step 4:** Rodar os testes do módulo e `npm run build`; Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): envio de planilha e leitura em fila`.

### Task 5: Conferência paginada

**Files:**
- Modify: `import.controller.ts`; Create: `application/import-review.service.ts`
- Test: `import-review.service.spec.ts`, `import.controller.spec.ts`

**Interfaces:**
- Produces: `GET /imports/:id` (status, contadores, tempos), `GET /imports/:id/rows?status=&cursor=&limit=` (padrão 50, máx 200; `limit` acima disso → 400), `PATCH /imports/:id/rows/:line` (só em `ready`, revalida e atualiza), `DELETE /imports/:id` (só antes de emitir), `GET /imports/template`, `GET /imports/:id/errors.csv` (fluxo, sem montar tudo na memória).

- [ ] **Step 1:** Testes: 120 linhas percorridas com `limit: 50` sem repetição; `limit: 500` → 400; PATCH fora de `ready` → 409; importação de outro tenant ou ambiente → 404; `errors.csv` traz só linhas inválidas e rejeitadas.
- [ ] **Step 2:** Rodar; Expected: FAIL.
- [ ] **Step 3:** Implementar. `errors.csv` pagina internamente por cursor e escreve em `StreamableFile`.
- [ ] **Step 4:** Rodar; Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): conferência paginada de importações`.

### Task 6: Emissão em pedaços e acompanhamento

**Files:**
- Create: `application/import-emit.service.ts`, `jobs/import-emit.processor.ts`
- Modify: `import.controller.ts` (`POST /imports/:id/emit`), `import.repository.ts` (marcar linhas, `done`)
- Test: `import-emit.service.spec.ts`, `import-emit.processor.spec.ts`

**Interfaces:**
- Consumes: `InvoiceBatchService.emitBatch(items, tenantId, authContext): Promise<BatchResult>`.
- Produces: `emit(importId, authContext)`: só de `ready` (ou de `done` para reenviar linhas rejeitadas por limite); repetir enquanto `emitting` devolve o estado atual sem duplicar. O job pega pedaços de até 50 linhas `valid`/`rejected-por-limite`, um pedaço por vez, reconstrói o contexto de autenticação do usuário guardado, confere a permissão a cada pedaço e grava `accepted`/`rejected` com `invoice_id`. `done` quando não há linhas em `queued` nem notas ainda em processamento.

- [ ] **Step 1:** Testes: clique duplo em Emitir enfileira uma vez; pedaço de 50 com limite de créditos atingido na linha 30 → 30 `accepted`, 20 `rejected` por limite, e novo Emitir (após o `done`) reenvia só as 20 com a mesma chave; permissão revogada entre pedaços → restantes ficam pendentes com erro de permissão; reinício do processo no meio repete o pedaço sem duplicar notas (chave idempotente); `authorized` só sobe quando a nota é autorizada; importação só vira `done` com tudo final.
- [ ] **Step 2:** Rodar; Expected: FAIL.
- [ ] **Step 3:** Implementar. As linhas rejeitadas por limite são as únicas rejeitadas reenviáveis.
- [ ] **Step 4:** Rodar; Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): emissão da importação em pedaços`.

### Task 7: Limpeza, documentação e verificação final

**Files:**
- Create: `api/src/modules/import/jobs/import-cleanup.cron.ts`
- Modify: documentação da API (OpenAPI) e `web/lib/docs` se existir seção de endpoints
- Test: `import-cleanup.cron.spec.ts`

- [ ] **Step 1:** Teste: o cron remove do S3 arquivos com mais de 24 h de importações travadas e marca `failed`; apaga importações e linhas com mais de 30 dias.
- [ ] **Step 2:** Rodar; Expected: FAIL. Implementar; rodar; Expected: PASS.
- [ ] **Step 3:** Rodar a suíte completa do `api` e `npm run build`; Expected: tudo verde (anotar qualquer falha pré-existente pelo nome).
- [ ] **Step 4:** Commit `feat(api): limpeza de importações e documentação`.

## Self-Review

- Cobertura da spec: upload (T4), leitura/normalização (T2, T4), empresa por CNPJ ou escolha (T4), revisão e correção (T5), emissão e contadores (T6), modelo e CSV de erros (T5), paginação (T1, T5), S3 e limpeza (T3, T7), segunda emissão (T6), aviso de duplicata (T4).
- Fora do escopo: tela e cartão de economia; MCP e chave de API.
