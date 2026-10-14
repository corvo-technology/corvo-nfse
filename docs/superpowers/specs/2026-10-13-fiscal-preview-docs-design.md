# Spec 4 — Preview fiscal, observabilidade final e documentação

Data: 2026-10-13 · Status: rascunho para revisão · Depende de: Specs 1–3 · Escopo: `api/`

## 1. Objetivo

Expor a FiscalEngine sem emitir: `POST /v1/invoices/preview`. Fechar métricas, runbooks, Swagger e exemplos de integração.

## 2. Preview

- `POST /v1/invoices/preview` com o mesmo corpo de `CreateInvoiceDto` (`competenceDate` pode ser futura, sem exigir `options.type`).
- Executa o **mesmo** `FiscalEngineService` do worker, de forma síncrona, em contexto novo por requisição, com timeout total configurável.
- **Efeitos colaterais proibidos:** não reserva crédito, não consome numeração DPS, não grava invoice, outbox ou snapshot, não transmite à Sefin. Teste automatizado verifica que contagens de `nfse_invoices`, `nfse_dps_sequences`, `outbox_messages`, `invoice_fiscal_snapshots` e `credit_transactions` não mudam.
- Resposta `200`:
  - `preview: true` e aviso fixo de que os valores são pré-emissão e podem divergir da validação final da Sefin;
  - `classification` (códigos, fonte, versões de catálogo), `applicability` (por tributo: required/notApplicable/unsupported/missingConfiguration com razão), `taxes`, `withholdings`, `legalReferences`, `calculation` (fonte, versão da calculadora, versão das regras), `warnings`, `pendingFields[]`, `trace` resumido por etapa;
  - valores como strings decimais.
- Erros síncronos seguem o formato `{ error: { code, message, fields } }` com HTTP: `422` para VALIDATION/CONFIGURATION/CLASSIFICATION/UNSUPPORTED, `503` com `Retry-After` para INTEGRATION (RTC indisponível), `500` genérico para INTERNAL (sem stack). Mapeamento centralizado e testado.
- Segurança e custo: autenticação por API key/sessão como as demais rotas de invoice, permissão própria (`invoices:preview`), rate limit por tenant (a Calculadora é recurso compartilhado), isolamento por tenant/ambiente. Habilitado por `FISCAL_PREVIEW_ENABLED` (padrão `false`) até a validação de autorização e regras comerciais, conforme o briefing.

## 3. Observabilidade final

Dashboards e alertas sobre as métricas dos Specs 1–3 mais `fiscal_reconciliation_mismatch_total`, `nfse_authorization_failures_total`, `dps_validation_failures_total`. Runbooks curtos em `docs/` para: relay parado/`dead`, RTC indisponível, divergência de conciliação, layout não suportado. Correlation id propagado do HTTP até o job (reuso de `queue-trace-context`).

## 4. Documentação

- Swagger: `options.type`, `scheduledFor`, `service.fiscal`, `service.serviceProfileId`, `customer` opcional, endpoints de perfil fiscal, preview, webhooks novos (`nfse.invoice.fiscal_discrepancy`) e catálogo de códigos de erro fiscais.
- `api/FRONTEND_API.md`, `api/llms.txt`, `api/TENANT_ISOLATION.md` atualizados.
- Exemplos de integração (curl) para: barbearia MEI sem tomador, barbearia com cliente, consultoria de tecnologia, Simples Nacional, override fiscal com códigos reais de catálogo oficial, agendamento `SCHEDULE`, produto físico (erro), preview.
- Documento "limitações e cenários não homologados" mantido junto aos testes: o que foi validado contra a Calculadora real e a Produção Restrita, e o que não.

## 5. Testes

Preview não tem efeitos colaterais; paridade preview × cálculo do worker para as mesmas entradas e mesma data; mapeamento de erros; rate limit e permissão; isolamento entre tenants; 503/`Retry-After` com RTC fora; contrato do Swagger (`http-contract.spec.ts`/`api-contract` existentes).

## 6. Decisões em aberto

- **F1:** o preview consome alguma quota comercial? Proposta: não consome crédito de emissão, mas tem rate limit próprio.
- **F2:** retenção/auditoria das chamadas de preview (proposta: apenas métricas, sem persistir payload).

## 7. Fora de escopo

Persistir simulações, preview em lote, UI no `web/`.
