# Mapa de retenção de dados do Corvo (base: origin/main f78e8319)

## Status: o que já é limpo

| Tabela | Regra | Quando | Modo |
|---|---|---|---|
| `account_audit_events` | mais de 365 dias | todo dia 03:00 | apaga |
| `imports` e `import_rows` | mais de 30 dias | todo dia 03:30 (São Paulo) | apaga |
| `outbox_messages` | `completed` há mais de 14 dias; `dead` há mais de 90 dias; `completed` ou `dead` de ambiente `test` há mais de 3 dias | todo dia 04:00 (São Paulo), no worker | **simulação** até `DATA_RETENTION_ENABLED=true` |

Como a limpeza da outbox funciona (`api/src/modules/invoice/jobs/outbox-retention.scheduler.ts`, base em `api/src/infra/retention/data-retention.ts`):

- Só entram linhas já terminadas (`completed`, `dead`). `pending` e `claimed` nunca, e as agendadas para o futuro são `pending`, então também nunca. A data usada é `updated_at` (o `complete()` e o `markDead()` a gravam; `completed_at` fica vazio nas `dead`).
- Uma linha terminada também fica se a mesma nota/documento (`aggregate_id`) ainda tem mensagem `pending` ou `claimed`.
- Apaga em lotes de 1000, no máximo 200 lotes por regra por noite (200 mil linhas). O que sobrar sai na noite seguinte.
- `DATA_RETENTION_ENABLED` (padrão `false`): em simulação só conta e registra. Ligue no worker depois de uma semana de logs.
- Cada regra registra uma linha `event=data_retention` com `table`, `rule`, `dryRun`, `matched` (linhas que a regra pegaria), `deleted` e `durationMs`. Em simulação `deleted` é sempre 0 e `matched` é o que seria apagado.
- Índice parcial novo `idx_outbox_finished_updated (updated_at) WHERE status IN ('completed','dead')`. É um `CREATE INDEX` comum: nenhuma migration do projeto usa `transaction = false`, e a outbox ainda é pequena.

Por que apagar não deixa entrar mensagem duplicada: a chave única `(tenant_id, dedupe_key)` só serve para o mesmo passo, inserido duas vezes em pouco tempo, virar uma mensagem. Toda chave leva o id do que ela trata (`calc:{invoiceId}`, `emission:{invoiceId}`, `cancellation:{requestId}`, `{tipo}:{eventoId}:{tentativa}`, `reconcile:event:{id}:{tentativa}`). A mensagem é inserida na mesma transação da mudança de estado que a exige, e repetir essa mudança é barrado pelo próprio estado (chave de idempotência e status da nota), não pela outbox. Depois de 14 dias uma mensagem terminada já passou de qualquer retentativa, e a trava extra acima protege a nota ainda em andamento. As mensagens agendadas (até 15 dias à frente) são `pending` e não são tocadas.

Só leitura. Fontes: entidades `*.orm-entity.ts`, migrations em `api/src/infra/database/migrations`, `git grep` por delete/purge/retention/@Cron/removeOn*. Não olhei produção: as contagens abaixo são estimativas pelo código, não medições.

## 0. Resumo

- Existem só **3 limpezas** no código hoje: `account_audit_events` (365 dias), `imports` + `import_rows` (30 dias) e o arquivo da planilha no S3 (24 h). Mais o TTL do Redis (OTP, limite de taxa, cache) e `removeOnComplete/removeOnFail` do BullMQ.
- **`outbox_messages` não tem limpeza nenhuma.** Linhas `completed` e `dead` ficam para sempre (o relay só faz INSERT, claim, complete, release, markDead). O payload tem só IDs (sem PII), então o risco é tamanho/índices, não privacidade.
- Pior que a outbox em volume e em PII: `webhook_deliveries` (payload jsonb + response_body de quem recebeu), `integration_events` (payload cifrado), `webhook_events` (inbox de Stripe/Woovi), `nfse_invoice_events`, `nfe_document_history/events` (com XML em coluna `text`), `portal_documents.xml` (XML inteiro no banco).
- Dados com **ambiente `test`** (homologação) não têm obrigação fiscal e podem ser podados bem antes dos de `live`. Quase toda tabela tem a coluna `environment`.
- Redis: filas de emissão/cancelamento/doc-prep/reconcile usam `removeOnComplete: false`, ou seja, **jobs concluídos nunca saem do Redis**.
- S3: nenhuma regra de ciclo de vida no repo (`deploy/scripts/init-s3.sh` só cria o bucket). Só a planilha de importação é apagada.

## 1. Inventário das tabelas que crescem

Legenda de limpeza: NENHUMA = nada no código; PARCIAL; SIM.
"Linhas por nota" é estimativa pelo código. PII = CPF/CNPJ, e-mail, endereço, nome.

### 1.1 Fila e eventos operacionais (maiores candidatas)

| Tabela | Entidade | Quem escreve | Volume | PII/segredo | Limpeza |
|---|---|---|---|---|---|
| `outbox_messages` | `modules/invoice/infra/outbox-message.orm-entity.ts` | `OutboxService.enqueue` (`typeorm-outbox.repository.ts` INSERT ... ON CONFLICT (tenant_id, dedupe_key)). Tipos: `invoice.calculate_taxes` (`calc:{invoiceId}`), `invoice.emit`, `invoice.cancel` (`cancellation:{eventId}`), `nfe.*` (prepare, send, reconcile por tentativa, inutilização) | NFS-e: 2 linhas por nota (calc + emit) + 1 por pedido de cancelamento. NF-e/NFC-e: mais, com uma linha por tentativa de reconciliação/envio de evento | Não: payload só com `invoiceId/companyId/tenantId/requestId`. `last_error` é texto livre | **NENHUMA.** Status `completed` e `dead` acumulam. Unique `(tenant_id, dedupe_key)` e 4 índices crescem junto |
| `webhook_deliveries` | `modules/webhooks-config/infra/webhook-delivery.orm-entity.ts` | `WebhookOutboxService.enqueue` (uma linha por evento por webhook configurado). Tentativas **atualizam a mesma linha** (`retry_count`, até 5), não criam linhas | ~3 a 4 por nota por webhook (authorized, documents_ready, email_sent, ...) | **Sim**: `payload jsonb` (corpo do evento), `url` do cliente, `response_body` do servidor deles, `last_error` | **NENHUMA** (só leitura e retry) |
| `webhook_events` | `infra/persistence/typeorm/entities/webhook-event.orm-entity.ts` | Inbox de provedores (Stripe/Woovi): `payload jsonb`, `payload_sha256`, estados received/processed/ignored/failed/manual_review | 1 por evento de pagamento | Sim: payload do provedor (e-mail/ID de cliente de cobrança). Sem RLS | **NENHUMA** |
| `integration_events` | `modules/integrations/infra/integration-event.orm-entity.ts` | Inbox genérica de integrações (`event-processor.scheduler.ts`); `payload_enc` cifrado, `delivery_id` | 1 por webhook recebido de plataforma externa | Sim, cifrado (`payload_enc`) | **NENHUMA** |
| `integration_operations` | `integration-operation.orm-entity.ts` | Uma operação por venda externa (`operation_key`), com `snapshot jsonb` e `emission_request jsonb` | 1 por venda | **Sim**: snapshot e pedido de emissão (tomador, CPF/CNPJ, e-mail) | **NENHUMA**. Atenção: `docs/integrations/architecture.md` §17 diz que a limpeza de payload **não pode apagar as identidades** que impedem emissão duplicada |
| `invoice_schedule_runs` | `modules/invoice-schedule/infra/invoice-schedule-run.orm-entity.ts` | Uma linha por ocorrência/tentativa de agenda (`outcome`, `error_message`) | 1 por execução de agenda recorrente | Não | **NENHUMA** |
| `lifecycle_email_sends` | `modules/lifecycle-emails/infra/lifecycle-email-send.orm-entity.ts` | Livro-razão (tenant, kind, period) para não repetir e-mail; só é apagado em falha de envio (`lifecycle-email.ledger.ts:43`) | Poucas por tenant por mês | Não | Quase não cresce; é anti-duplicidade, manter |

### 1.2 Fiscais (tratar com cuidado)

| Tabela | Entidade | Quem escreve | Volume | PII | Limpeza |
|---|---|---|---|---|---|
| `nfse_invoices` | `modules/invoice/infra/invoice.orm-entity.ts` | Emissão. Guarda `customer_snapshot`, `service_snapshot`, `tax_snapshot`, `email_snapshot`, `access_key`, `idempotency_key` (único por tenant+ambiente) | 1 por nota | **Sim** (tomador) | NENHUMA. É a prova fiscal e a chave de idempotência: **não apagar** |
| `nfse_invoice_events` | `invoice-event.orm-entity.ts` | Uma linha por mudança de status (`from_status`, `to_status`, mensagem, `portal_event`, `portal_nsu`) | ~3 a 5 por nota | Pouca (texto de erro) | NENHUMA |
| `invoice_fiscal_snapshots` | `invoice-fiscal-snapshot.orm-entity.ts` | Resultado imutável do cálculo fiscal (jsonb), trigger de imutabilidade | 1 por tentativa de cálculo | Valores, não pessoas | NENHUMA; é a memória de cálculo da nota autorizada |
| `invoice_fiscal_reconciliations` | `fiscal/invoice-fiscal-reconciliation.orm-entity.ts` | Inserts idempotentes por reconciliação (`local_values`, `authorized_values`, diffs) | 1 por nota autorizada (mais em redo) | Não | NENHUMA |
| `nfe_documents`, `nfe_document_items` | `modules/nfe/infra/nfe-document*.orm-entity.ts` | NF-e/NFC-e | 1 + N itens por documento | **Sim** (destinatário) | NENHUMA; fiscal |
| `nfe_document_history` | `nfe-document-history.orm-entity.ts` | Uma linha por transição (cStat, xMotivo, `access_key`) | ~3 a 6 por documento | Não | NENHUMA |
| `nfe_document_events` | `nfe-document-event.orm-entity.ts` | Eventos (cancelamento, CC-e): `request_xml`, `proc_xml` em **coluna text**, `xml_path` | 0 a N por documento | XML do evento | NENHUMA; fiscal, e pesada (XML no banco) |
| `nfe_inutilizations`, `nfe_number_sequences`, `nfe_contingency_states` | `nfe-*.orm-entity.ts` | Inutilização, numeração, contingência/SVC | poucas | Não | NENHUMA. Numeração e inutilização são fiscais |
| `portal_documents` | `modules/portal-sync/infra/portal-document.orm-entity.ts` | `portal-sync.scheduler.ts` (a cada 5 min): XML de notas/eventos lidos do portal nacional, **`xml text`** por linha, `attempts`, `last_error` | 1 por documento do portal (inclui notas recebidas) | **Sim**: XML inteiro com CPF/CNPJ de terceiros | NENHUMA. Mesmo tratamento do XML fiscal; hoje fica no banco, não no S3 |
| `portal_sync_cursors` | `portal-sync-cursor.orm-entity.ts` | Cursor NSU por empresa/ambiente | 1 por empresa | Não | n/a (estado) |
| `nfse_dps_sequences` | `dps-sequence.orm-entity.ts` | Numeração DPS | 1 por série | Não | n/a; decisão de 25/11: pular número já usado, não apagar |
| `accountant_package_sends` | `invoice/infra/accountant-package-send.orm-entity.ts` | Um envio mensal por empresa (recipient, mês, contagem, total) | 1 por empresa por mês | E-mail do contador | NENHUMA (cresce devagar). O ZIP é gerado em fluxo, **não** é guardado |

### 1.3 Dinheiro e plano

| Tabela | Entidade | Observação | Limpeza |
|---|---|---|---|
| `credit_transactions` | `modules/credits/infra/credit-transaction.orm-entity.ts` | Livro-razão: reserva, confirmação, estorno por nota. `docs/architecture.md:152`: "um lançamento por movimento, **nunca apagado**" | NENHUMA, por desenho. Manter |
| `billing_usage_periods` | `modules/billing/infra/billing.orm-entity.ts` | 1 por tenant por período | NENHUMA, pequena. Manter |
| `payment_intents` | `billing/infra/payment-intent.orm-entity.ts` | Checkout (Pix/Stripe), `checkout jsonb` com QR/copia-e-cola, expiradas ficam `expired` | NENHUMA. Sem RLS (webhook acha por `provider_ref`) |
| `tenant_billing`, `plans`, `document_credit_prices` | | Estado/catálogo | n/a |
| `free_note_claims` | `modules/auth/infra/free-note-claim.orm-entity.ts` | PK `email_key`; anti-abuso da nota grátis | NENHUMA; pequena, e apagar reabre a nota grátis. Manter (ou guardar só hash) |

### 1.4 Auditoria, autenticação, cadastros

| Tabela | Entidade | Observação | Limpeza |
|---|---|---|---|
| `account_audit_events` | `account-audit/infra/account-audit-event.orm-entity.ts` | `ip_hash`, `actor_label`, `metadata jsonb` | **SIM**: 365 dias, diário 03:00 (§2) |
| `platform_admin_audit_events` | `platform-admin/infra/platform-admin-audit.orm-entity.ts` | `actor_email`, `reason`, `ip_hash`. Plano `2026-11-23-platform-admin.md:20`: "guarda para sempre" | NENHUMA, de propósito. Sem RLS |
| `auth_audit_events` | `infra/persistence/typeorm/entities/auth.orm-entities.ts` | `ip_hash`, `user_agent`, `metadata`, `session_id` FK | **NENHUMA**. Tabela global, sem RLS |
| `auth_sessions` | idem | Revogadas/expiradas só ganham `revoked_at`; ninguém apaga (repositório só tem update/save) | **NENHUMA**. Guarda só hashes de token |
| `auth_authorization_codes` | idem | Códigos OAuth (vida curta), `consumed_at` | **NENHUMA** (expirados e consumidos ficam) |
| `auth_users`, `auth_identities`, `auth_oauth_clients` | idem | Identidade; `access_token_encrypted`, `refresh_token_encrypted` em `auth_identities` | n/a (cadastro). Sem fluxo de exclusão de conta no código |
| `tenant_invitations` | `entities/tenant-invitation.orm-entity.ts` | Convites expirados continuam (filtro `expiresAt > now()` só na leitura). Guarda e-mail | **NENHUMA** |
| `api_keys` | `modules/auth/infra/api-key.orm-entity.ts` | `key_hash`, `expires_at`, `last_used_at` | Só apaga por ação do usuário |
| `mcp_connections` | `modules/mcp/infra/mcp-connection.orm-entity.ts` | Uma por (usuário, tenant, client); `ON DELETE CASCADE` com a sessão | Segue a sessão (que nunca é apagada) |
| `customers` | `invoice/infra/customer.orm-entity.ts` | Cadastro reutilizável de tomadores (CPF/CNPJ, nome, e-mail, endereço) | Só `DELETE /v1/customers/:taxId` por ação do usuário. A spec `2026-11-10-customers-...:80` já pede "revisar finalidade e prazo de retenção antes do merge" |
| `service_favorites`, `company_*`, `nfse_companies`, `nfse_certificates` | | Cadastros. Empresa e certificado usam `deleted_at` (exclusão lógica) | Exclusão lógica sem purge. `nfse_certificates` guarda segredo cifrado: ver §4 |
| `imports`, `import_rows` | `modules/import/infra/*.orm-entity.ts` | Planilha lida; `import_rows.data jsonb` com linhas do cliente (CPF/CNPJ) | **SIM**: 30 dias (§2) |
| `tenants`, `tenant_memberships`, `tenant_settings`, `integration_connections`, `integration_rules`, `webhook_configs`, `company_nfe_settings`, `nfe_enabled_authorities` | | Configuração | n/a |

### 1.5 Idempotência, sessão, OTP, limite de taxa, Turnstile

Não há tabelas para isso. Idempotência fica nas **colunas únicas** `nfse_invoices(tenant_id, environment, idempotency_key)`, `payment_intents(tenant_id, idempotency_key)`, `invoice_schedules.idempotency_key`, `nfe_inutilizations`, `outbox_messages(tenant_id, dedupe_key)` e no `jobId` do BullMQ. OTP, prova de OTP, atestado Turnstile e limite de taxa estão no Redis **com TTL** (`redis-otp-challenge.store.ts` EX, `otp-verification-proof.service.ts` EX, `turnstile-attestation.service.ts` EX e `expire 60`, `shared/http/redis-rate-limiter.ts` `expire(ttlSeconds)`). Não há tabela de log MCP/agente além de `mcp_connections` (sem histórico de chamadas).

### 1.6 Logs de e-mail
Não há tabela de envio de e-mail por nota. `lifecycle_email_sends` é o único registro; o resto vai por fila (`email`, `nfse-email`) e para o provedor.

## 2. Limpezas que existem hoje

| Arquivo | Agenda | Apaga | Lote | Variáveis |
|---|---|---|---|---|
| `api/src/modules/account-audit/jobs/account-audit-retention.scheduler.ts` (`AUDIT_RETENTION_DAYS = 365`) | `@Cron` todo dia 03:00 | `account_audit_events` com `occurred_at` > 365 dias, por tenant (`TenantWorkDiscovery.visit('account-audit-retention')`, 100 tenants por página, `runWithTenant` em cada) | **Sem lote**: um `DELETE` por tenant | Nenhuma (constante) |
| `api/src/modules/import/jobs/import-cleanup.cron.ts` | `30 3 * * *` America/Sao_Paulo | (a) arquivos S3 `imports/` com mais de 24 h (marca falha se ainda `processing`, senão remove); (b) `failStuck` (processing > 24 h vira failed); (c) `imports.deleteOlderThan(30)`, que leva `import_rows` junto (FK) | **Sem lote**; a listagem do S3 é `ListObjectsV2` com prefixo `imports/` | Nenhuma (constantes `ORPHAN_FILE_HOURS=24`, `KEEP_DAYS=30`). Usa `runAsSystem('import-housekeeping')`, com entradas na allowlist do `tenant-predicates.spec.ts` |
| `certificate-expiry.scheduler.ts` | meia-noite | Só muda status de certificado para `expired` (não apaga) | n/a | n/a |
| `portal-sync`, `docs-recovery`, `manual-review-sweep`, `nfe-number-gaps`, `nfe-svc-switch`, `billing.scheduler`, `schedule.cron`, `accountant-package`, `lifecycle-emails` | vários | Recuperação/negócio, **não** limpam | n/a | n/a |

Variáveis do outbox (`env.schema.ts:358-368`): `OUTBOX_RELAY_INTERVAL_MS` (1000), `OUTBOX_BATCH_SIZE` (50), `OUTBOX_LEASE_MS` (120000), `OUTBOX_MAX_ATTEMPTS` (10), `OUTBOX_SCHEDULE_MAX_DAYS` (15). **Nenhuma** é de retenção.

## 3. Redis / BullMQ

Padrão (`infra/redis/bullmq-queue.helpers.ts`): `removeOnComplete: true`, `removeOnFail: 1000`. Vários chamadores sobrescrevem para **`removeOnComplete: false`** (concluído fica para sempre):

- `invoice-emit.handler.ts:36`, `invoice-cancel.handler.ts:59`, `invoice-pdf-refresher.ts:32`, `invoice.service.ts:734`, `nfse-workflow.service.ts:738,761`, `nfse-doc-prep.processor.ts:164`, `docs-recovery.scheduler.ts:139,184`, e o default da fila `nfse-fiscal-reconcile` em `invoice.module.ts:140`. Filas afetadas: `nfse-emission`, `nfse-cancellation`, `nfse-doc-prep`, `nfse-reconciliation`, `nfse-fiscal-reconcile`.
- Efeito: um job concluído por nota por fila fica no Redis (hash + chave de job). `removeOnFail: 1000` mantém no máximo 1000 falhas por fila (ok).
- Cuidado: o `jobId` é a chave de idempotência (`emission-{id}`, ...). Manter o job concluído também **impede** reenfileirar o mesmo id. Trocar para remover tem de considerar isso (use `removeOnComplete: { age, count }`, não `true`).
- Corretos: `email` e `nfse-email` (`removeOnComplete: true`, `removeOnFail: 0`; confirmar o significado de `0` na versão do BullMQ em uso), `import-read/import-emit` (true/true), `manual-review-sweep` (true/100), `docs-recovery` linha 105 (true/true).
- Chaves sem TTL no Redis fora das filas: `reachability.store.ts` (`STATE_KEY`/`PROXY_KEY` com `SET` sem expiração, 2 chaves fixas, ok); `gov-rate-limiter.ts` (pausa com `PX`, ok); `fiscal-portal-breaker.ts` (`pexpire`, ok); cache de saldo `credit:balance:{tenant}` (TTL 24 h no `RedisCacheService`).

## 4. S3 / armazenamento de objetos

Bucket `STORAGE_S3_BUCKET` (padrão `corvo-nfse`). Chaves (`infra/storage/infra/s3-storage.ts`):

- `{tenant}/{env}/invoices/{invoiceId}/invoice.xml` e `.pdf` (NFS-e). Escritos em `nfse-workflow.service.ts:707` (XML) e `nfse-doc-prep.processor.ts:262` (PDF). A coluna `authorized_xml` foi removida do banco (migration `DropInvoiceAuthorizedXml`), então o **S3 é a única cópia do XML autorizado**.
- `{tenant}/{env}/nfe/{docId}/{arquivo}` (nfe-proc.xml, DANFE etc.) e `{tenant}/{env}/nfe-inutilizacoes/{id}.xml` (`nfe-files.service.ts`, `nfe-prepare-documents.handler.ts`).
- `imports/{tenant}/{env}/{importId}` (planilha; apagada após leitura e pelo cron).
- Não há ZIP salvo: o pacote do contador é montado em fluxo (`invoice-package.service.ts`).
- Certificados A1: ficam no banco (`nfse_certificates`, cifrados), não no S3.

Ciclo de vida: nada em código ou em `deploy/` (`init-s3.sh` só cria o bucket; `deploy/docker-compose*.yml` não define regra). Nenhum `DeleteObject` fora do import. Órfãos: ao apagar linhas do banco por cascata (tenant `ON DELETE CASCADE`, empresa com `deleted_at`) os objetos `{tenant}/...` **não são removidos**. Não existe fluxo de exclusão de tenant/conta no código, então hoje o problema é teórico, mas qualquer purge futuro por tenant precisa apagar por prefixo `{tenant}/`.

## 5. Restrições legais e fiscais (só o que o repo já diz)

O repo **não fixa prazo legal** em lugar nenhum. O que está escrito:

- `docs/architecture.md:152`: `credit_transactions` é livro-razão, "nunca apagado".
- `docs/superpowers/specs/2026-10-13-rtc-dps-reconciliation-design.md:62`: XML original e autorizado persistidos "conforme a política de retenção atual (S3, sem XML em log)". Não há política escrita além disso.
- `docs/integrations/architecture.md:372`: payloads de replay precisam de acesso restrito e **política explícita de retenção**; limpar payload **não pode apagar as identidades** que impedem nova emissão.
- `docs/superpowers/specs/2026-11-10-customers-complementary-info-convenio-design.md:80`: cadastro de clientes é tratamento novo de dado pessoal; revisar finalidade e prazo.
- `README.md:221`: LGPD se aplica a quem opera; o Corvo é operador.
- `docs/superpowers/plans/2026-11-23-platform-admin.md:20`: auditoria de admin "guarda para sempre".
- Plano NFC-e: logs sem XML inteiro, sem CPF do consumidor.
- Decisão do dono (memória, 25/11/2026): número de DPS já usado no governo deve ser pulado, não reaproveitado, então a numeração não pode ser apagada.

Pergunta em aberto para o dono/contador (não inventei prazo): qual prazo de guarda de XML fiscal e documentos auxiliares o Corvo assume como operador. A proposta abaixo trata XML autorizado e eventos fiscais como "guardar, prazo a decidir" e não os toca.

**Não apagar:** `nfse_invoices`, `nfse_invoice_events`, `invoice_fiscal_snapshots`, `invoice_fiscal_reconciliations`, `nfe_documents`, `nfe_document_items`, `nfe_document_history`, `nfe_document_events`, `nfe_inutilizations`, `nfe_number_sequences`, `nfse_dps_sequences`, `credit_transactions`, `billing_usage_periods`, `platform_admin_audit_events`, `free_note_claims`, os XML/PDF no S3 de `live`, e os jobs/linhas que sirvam de idempotência (`idempotency_key`, `integration_operations.operation_key`, `dedupe_key` enquanto o replay for possível).

**Pode podar (após janela):** linhas de outbox `completed`, tentativas de webhook enviadas com sucesso, payloads brutos de inbox já processados, tudo de `environment='test'`, sessões e códigos expirados, convites expirados.

## 6. Proposta priorizada

Mecanismo comum para os jobs abaixo: um `@Cron` no worker (`worker-app.module.ts`), `observeScheduledTask(...)`, `DELETE` em lotes pequenos (ex.: `WHERE id IN (SELECT id ... LIMIT 1000 ... FOR UPDATE SKIP LOCKED)`) com pausa entre lotes, parando por tempo máximo. Constantes por env var com padrão no `env.schema.ts` (hoje a retenção de auditoria e import é constante fixa). Métrica de linhas apagadas por tabela.

Sobre tenant: as tabelas com RLS (`rls-tables.ts`) deixam passar com `app.system_context='on'`. Duas formas válidas: (a) `runAsSystem('<purpose>')` com SQL cru (`dataSource.query`) ou query builder, como `typeorm-outbox.repository.ts` e `typeorm-import.repository.ts#deleteOlderThan`. É preciso **novo valor em `SystemPurpose`** (`tenant-context.storage.ts`, ex.: `'retention'`) e, se usar `repo.delete/.update/.find`, **uma entrada na allowlist** de `infra/persistence/tenant-predicates.spec.ts` com chave `arquivo#metodo#chamada` e justificativa (o guard só confere `save/update/delete/remove/find*...` em repositórios/query builders; SQL cru por `dataSource.query` não é conferido, mas prefira o padrão do import e justifique). (b) `TenantWorkDiscovery.visit('<kind>')` como a auditoria: um tenant por vez com `runWithTenant`, sem allowlist, mas com mais consultas (adicionar o `kind` ao tipo `TenantWork` e à cadeia de `discover`). Para tabelas **sem RLS** (`auth_*`, `webhook_events`, `payment_intents`, `platform_admin_audit_events`) a allowlist já tem `auth.repositories.ts#*`; as demais precisam de entrada.

Ordem e retenção sugerida (valores são proposta, a decidir com o dono):

| # | Tabela / recurso | Retenção sugerida | Mecanismo | Riscos |
|---|---|---|---|---|
| 1 | `outbox_messages` | `completed`: 7 a 14 dias após `completed_at`. `dead`: 90 dias (alerta já existe: `recordOutboxDead`). `pending`/`claimed`: nunca. Linhas `environment='test'`: 3 dias | Job diário, lotes, `DELETE ... WHERE status='completed' AND completed_at < now() - interval`. Índice parcial novo em `(completed_at) WHERE status IN ('completed','dead')` (hoje os índices parciais só cobrem pending/claimed) | `uq_outbox_tenant_dedupe`: apagar libera o `dedupe_key`; seguro porque `calc:{invoiceId}` é inserido na mesma transação da criação da nota (replay idempotente barra antes pela chave da nota). `nfe` usa chaves com tentativa, mas confirme `reconcile:event:{id}:{attempt}`. Não apagar `scheduled` (até 15 dias à frente; `OUTBOX_SCHEDULE_MAX_DAYS`). Medir bloat e rodar `VACUUM` depois do primeiro purge grande |
| 2 | `webhook_deliveries` | `sent`: 30 dias (payload e `response_body` esvaziados ou linha apagada). `failed`: 90 dias. `pending/delayed/manual_retry`: nunca. `test`: 7 dias | Job diário em lotes; opção 2 passos: `UPDATE SET payload=NULL, response_body=NULL` aos 30 dias e `DELETE` aos 90 | A tela e o MCP `webhook_deliveries_list` e o retry manual leem a linha: manter metadados mais tempo que o corpo. `payload IS NULL` já é tratado no processamento ("has no payload, skipping"); confirmar o retry manual para linha sem payload. Índice em `(status, created_at)`. Tem PII e `url` do cliente |
| 3 | Redis: jobs concluídos | `removeOnComplete: { age: 7*24*3600, count: 10000 }` nas filas de emissão, cancelamento, doc-prep, reconcile | Mudar as opções (sem job novo) | O `jobId` é idempotência: depois da janela o mesmo id pode ser enfileirado de novo. Hoje a barreira real é o status da nota/outbox, mas conferir cada handler antes |
| 4 | `webhook_events` (inbox Stripe/Woovi) | `processed/ignored`: payload apagado ou linha apagada após 90 dias; `failed/manual_review`: nunca automático | Job diário, lotes. Sem RLS (allowlist) | `eventSeen` usa a linha como deduplicação de evento: apagar libera reprocessamento de evento antigo. Manter a linha com `payload=NULL` e `payload_sha256`/`provider_event_id` (anonimizar) é mais seguro que apagar |
| 5 | `integration_events` | Processado: 30 a 60 dias | Job com `integration-inbound`/novo purpose | `delivery_id` é a dedupe da inbox; manter só metadados e zerar `payload_enc` (a spec §17 exige proteger e manter identidades) |
| 6 | `integration_operations` | `snapshot`/`emission_request` anonimizados depois de N dias da nota autorizada; **manter a linha e `operation_key`** | UPDATE em lote | Replay/ressolução de operação "esperando você" precisa do snapshot enquanto não tiver nota |
| 7 | `auth_sessions`, `auth_authorization_codes`, `auth_audit_events`, `tenant_invitations` | Sessão: 30 dias após `expires_at`/`revoked_at`. Código OAuth: 7 dias após expirar. Auditoria de auth: 365 dias (igual à de conta). Convite: 30 dias após expirar | Um job só ("auth-housekeeping"), lotes, sem RLS (a allowlist já cobre `auth.repositories.ts#*`; convites precisam de entrada) | `mcp_connections.session_id` tem FK `ON DELETE CASCADE`: apagar sessão antiga **derruba a conexão MCP** do usuário. Só apagar sessões que já estão mortas, e conferir o que `mcp_connections` espera. `auth_audit_events.session_id` também é FK: apagar eventos antes das sessões |
| 8 | `environment='test'` em geral (`nfse_invoices`, eventos, snapshots, S3 `{tenant}/test/...`, nfe_*) | 30 a 90 dias | Job por tenant, apagando em ordem de dependência e depois S3 por prefixo | Sem valor fiscal, mas o cliente usa para integrar; avisar. Vai exigir mapa de FKs |
| 9 | `invoice_schedule_runs` | 12 meses (prova de execução) ou 90 dias | Lotes por `created_at` | Tela de histórico (`schedule_runs` no MCP) |
| 10 | `portal_documents.xml` | Mover para S3 e esvaziar a coluna depois de processada (não apagar a linha) | Migração + job | É XML fiscal de terceiros; prazo depende da decisão do §5 |
| 11 | `nfe_document_events.request_xml/proc_xml` | Já têm `xml_path` (S3). Esvaziar a coluna text depois que o arquivo estiver no S3 | UPDATE em lote | Só após conferir que o arquivo existe (`fileExists`) |
| 12 | `payment_intents` expiradas | 180 dias | Lotes; sem RLS (allowlist) | Auditoria de cobrança; `provider_ref` único |
| 13 | `account_audit_events`, `imports`, `import_rows` (já existem) | manter 365 dias e 30 dias, mas **colocar em lotes** e configurar por env | Reaproveitar | `DELETE` por tenant sem LIMIT pode travar tabelas grandes |
| 14 | S3 | Regras de ciclo de vida do bucket: prefixo `*/test/*` expira em 90 dias; `imports/` expira em 2 dias (rede de segurança do cron); **não** configurar expiração para `*/live/invoices/` e `*/live/nfe/` até o prazo legal ser decidido. Versionamento + expiração de versões antigas | Infra (Terraform/console), não código | Regra de prefixo curinga com tenant no meio: S3 não aceita `*` no meio da chave; para `test` use tag no upload (`env=test`) e regra por tag, ou apague por job |

Antes de ligar qualquer purge: (1) contagem real por tabela e por status em produção (`SELECT status, count(*), pg_size_pretty(...)`), (2) decisão do prazo fiscal e do prazo LGPD de dados do tomador, (3) modo "dry-run" (contar e logar sem apagar) por uma semana, (4) métrica `retention_deleted_total{table}` e alerta se o job falhar ou ficar parado, (5) teste de integração `*.postgres.integration.spec.ts` por tabela, incluindo que `pending/claimed/scheduled` nunca saem.

Itens que não consegui confirmar só lendo o código: se existem regras de ciclo de vida já criadas direto no provedor de S3; o tamanho real das tabelas; o comportamento de `removeOnFail: 0` na versão do BullMQ em uso; quais tabelas fora de `rls-tables.ts` (`nfe_*`, `imports`, `customers`, `portal_documents`, `invoice_schedule_runs`, `integration_*` estão na lista só em parte) têm RLS criada por migration própria.
