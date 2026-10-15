# Observabilidade fiscal

Os instrumentos usam nomes `corvo.<área>.<métrica>` e o meter da respectiva área (`corvo.fiscal`, `corvo.nfse`, `corvo.rtc` ou `corvo.outbox`). Histogramas de duração e idade usam segundos (`s`). Os instrumentos fiscais são definidos em `api/src/modules/invoice/application/fiscal/fiscal.metrics.ts`; RTC e outbox mantêm seus módulos próprios.

## Nome no briefing → nome real

| Nome no briefing/anterior | Nome real | Atributos |
| --- | --- | --- |
| `fiscal_pipeline_duration` | `corvo.fiscal.pipeline.duration` | `ok` (`true`, `false`) |
| `fiscal_step_duration` | `corvo.fiscal.step.duration` | `step`, `status` (`applied`, `skipped`, `failed`) |
| `fiscal_step_failed_total` | `corvo.fiscal.step.failed.total` | `step`, `code` |
| `fiscal_step_skipped_total` | `corvo.fiscal.step.skipped.total` | `step` |
| `dps_validation_failures_total` | `corvo.fiscal.dps.validation.failed.total` | `code` |
| `nfse_authorization_failures_total` | `corvo.nfse.authorization.failed.total` | `code` |
| `tax_reconciliation_mismatches_total` | `corvo.fiscal.reconciliation.mismatch.total` | `tenantId` |
| `rtc_calculation_duration` | `corvo.rtc.calculation.duration` | `outcome` (`ok` ou código fiscal) |
| `rtc_calculator_latency` | `corvo.rtc.request.duration` | `path` (rota fixa da Calculadora RTC) |
| `rtc_calculation_failed_total` | `corvo.rtc.calculation.failed.total` | `reason` |
| `greenflow.rtc.version_info` | `corvo.rtc.version_info` | `version` |
| `outbox_published_total` | `corvo.outbox.published.total` | `type` |
| `outbox_publish_failures_total` | `corvo.outbox.publish.failed.total` | `type` |
| `outbox_dead_total` | `corvo.outbox.dead.total` | `type` |
| `outbox_claim_to_publish_duration` | `corvo.outbox.claim_to_publish.duration` | `type` |
| `outbox_pending_oldest_age_seconds` | `corvo.outbox.pending.oldest_age` | nenhum |
| novo: cálculo pré-emissão | `corvo.fiscal.calculate.total` | `status` (`ready`, `blocked`, `error`) |
| novo: duração do cálculo pré-emissão | `corvo.fiscal.calculate.duration` | `status` (`ready`, `blocked`, `error`) |

`reason`, `code`, `step` e `type` são identificadores estáveis. Nunca use mensagens de erro livres ou dados do cliente como atributos. O atributo existente `tenantId` da reconciliação foi preservado; avalie sua cardinalidade ao configurar o backend de métricas.

Os demais scopes/instrumentos OpenTelemetry anteriormente iniciados por `greenflow.` usam `corvo.`: pool PostgreSQL, TypeORM, BullMQ, segurança e tarefas agendadas. Os atributos `greenflow.job.name`, `greenflow.workload.kind` e `greenflow.typeorm.transaction.result` passam a `corvo.job.name`, `corvo.workload.kind` e `corvo.typeorm.transaction.result`. Identidades de serviço/banco, cookies, Redis, contextos e breadcrumbs do Sentry e URLs externas permanecem iguais.

## Alertas recomendados

| Condição | Investigação |
| --- | --- |
| `corvo.outbox.pending.oldest_age` > 300 s por 10 min | Verificar relay, leases e disponibilidade do Redis; considerar `available_at` ao investigar mensagens agendadas. |
| aumento de `corvo.outbox.dead.total` > 0 | Inspecionar o erro sanitizado e seguir o runbook correspondente antes de recolocar a mensagem em `pending`. |
| falhas de `corvo.rtc.calculation.failed.total` > 10% dos cálculos em 5 min, ou `reason=circuit_open` | Usar como denominador a contagem de `corvo.rtc.calculation.duration`; seguir [Calculadora RTC indisponível](runbooks/rtc-unavailable.md). |
| aumento de `corvo.fiscal.reconciliation.mismatch.total` > 0 | Seguir [divergência de reconciliação](runbooks/reconciliation-divergence.md). |
| pico de `corvo.nfse.authorization.failed.total` | Agrupar por `code`, comparar ao volume autorizado e investigar rejeições da Sefin. |
| p95 de `corvo.fiscal.pipeline.duration` > 5 s | Comparar etapas e `corvo.rtc.request.duration` para localizar a latência. |

Contadores são cumulativos: use aumento/taxa na janela, levando em conta reinícios. Não há dashboard ou regra de alerta fiscal versionados neste repositório; as condições acima devem ser configuradas no backend de observabilidade. O coletor em `api/docker/otel-collector.yml` só encaminha telemetria.

## Logs e dados sensíveis

O contrato de logs fiscais requer `correlationId`, `invoiceId`, `companyId`, `step`, `errorCode`, `durationMs`, `rulesVersion`, `calculatorVersion` e `layout`. Registre valores conhecidos no ponto da execução; para cálculo pré-emissão, `invoiceId` é ausente porque nenhuma invoice é criada. Campos de versão/layout ainda não resolvidos devem permanecer ausentes; nunca fabrique valores. Use identificadores e códigos estáveis para correlacionar etapas com o snapshot e o resultado da Calculadora RTC.

Nunca logue PFX, senhas, XML completo, documentos completos (CPF/CNPJ) ou payloads completos de requisição/resposta. Evite nome do cliente, credenciais, certificado e dados pessoais em spans, métricas e mensagens. Logs operacionais devem permitir identificar a falha sem reconstruir o documento fiscal do cliente.
