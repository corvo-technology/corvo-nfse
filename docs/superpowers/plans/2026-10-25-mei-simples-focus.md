# Foco em MEI e Simples Nacional — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer toda nota de MEI e de Simples Nacional (ME/EPP) sair aceita pela Sefin/ADN, recusar outros regimes e destravar a emissão de 2027, liberando cada parte por flag de ambiente.

**Architecture:** Um serviço de flags (`RolloutFlagsService`) lê variáveis de ambiente (com canário por tenant). Cada mudança de comportamento fica atrás de uma flag que nasce desligada, de modo que "desligada" é idêntico ao comportamento atual. Regras de conformidade do Anexo I viram funções de domínio puras, usadas no intake síncrono (antes de reservar crédito) e repetidas no motor fiscal. Alíquotas mensais do Simples ganham tabela própria.

**Tech Stack:** NestJS, TypeORM + migrations, class-validator, zod (`env.schema.ts`), Jest, Postgres de teste (`MIGRATION_TEST_DATABASE_URL`), `open-nfse` 0.11.0, Next.js (web), vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-mei-simples-focus-design.md` (as seções citadas abaixo, como "6.3", são dessa spec).

## Global Constraints

- Flags (nomes exatos, lidas na subida do processo): `TAX_REGIME_RESTRICTION` (`off|on`), `FISCAL_DPS_CONFORMANCE` (`off|on`), `SIMPLES_TOTTRIB` (`off|on`), `SIMPLES_RATE_MODE` (`off|warn|block`), `SIMPLES_RATE_ENFORCED_FROM` (`YYYY-MM-DD`, vazio = sem data), `FISCAL_2027_SIMPLES_MEI` (`off|on`), `CNPJ_REGISTRY_CHECK` (`off|on`). Cada uma aceita `<NOME>_TENANTS` (lista de UUIDs separados por vírgula ou `*`) para canário. Padrão de todas: desligada.
- Com todas as flags desligadas o comportamento é idêntico ao atual; cada flag tem teste nos dois estados.
- Regimes aceitos quando `TAX_REGIME_RESTRICTION` está ligada: `'MEI'` e `'Simples Nacional'`. Erro de recusa: `422`, código `ERROR_TAX_REGIME_NOT_SUPPORTED`.
- Códigos de erro novos: `DEDUCTION_NOT_ALLOWED_FOR_REGIME`, `ERROR_SIMPLES_SUBLIMIT_NOT_SUPPORTED`, `SIMPLES_RATE_STALE` (warning), `MISSING_CONFIGURATION` com `missingFields: ['simplesRate.totalRate']`.
- Dedução proibida para MEI (E0436) e para ME/EPP com `regApTribSN = 1` fora da lista de `cTribNac` do Anexo I (E0441/E0442): `042201, 042301, 050901, 060101, 060201, 070201, 070202, 070501, 070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301`.
- MEI: sem retenção de ISS (E0583), sem `pAliq` (E0600), sem benefício municipal (E0534), sem `pTotTribSN` (E0710), `totTrib` com `indTotTrib = 0`, nunca `regApTribSN` (E0162).
- ME/EPP: `regApTribSN` obrigatório (E0166), nunca `indTotTrib` (E0712), `totTrib` com `pTotTribSN`.
- `regApTribSN` suportado: somente 1 (`simplesApuracao = 'SN'`). Valores 2 e 3 são recusados.
- Alíquota mensal: resolução = linha do mês de competência, senão a do mês anterior mais próximo, senão ausente. Percentuais com no máximo 2 casas, de 0 a 100. Defasagem maior que 1 mês gera warning `SIMPLES_RATE_STALE`.
- Migrations seguem `api/src/infra/database/migrations/` (timestamps crescentes; a última existente é `1792400000000-AddFiscalProfileSimplesIssRate.ts`), com `down` reversível.
- Mensagens ao usuário em inglês na API (como o resto do código); docs em EN e PT.

## Review Focus

- Competência a partir de 2027 de MEI/ME/EPP com `FISCAL_2027_SIMPLES_MEI=off`: continua bloqueada com `TAX_CALCULATION_UNSUPPORTED` (nunca emitir meia nota).
- ME/EPP sem nenhuma alíquota informada com `SIMPLES_RATE_MODE=warn`: emite e avisa; com `block`: `422` antes de reservar crédito; com `off`: comportamento atual (zeros).
- Dedução em MEI chega pela API, pelo MCP (`nfse_issue`), pelo lote (`POST /invoices/batches`) e pela tool de lote: nos quatro caminhos é recusada antes de reservar crédito (no lote, como item `rejected`).
- Tenant fora da lista `*_TENANTS` com a flag ligada: comportamento antigo.
- Alíquota informada para mês futuro ou para empresa de outro tenant: recusada.
- Troca de `taxRegime` de MEI para Simples e vice-versa ao longo do tempo: a regra usa o perfil vigente na **data de competência**, não o regime atual da empresa.

---

## Fase 0 — antes de 01/11/2026

### Task 1: Serviço de flags de rollout

**Files:**
- Modify: `api/src/infra/config/env.schema.ts` (junto de `FISCAL_IBSCBS_UNAVAILABLE_MODE`, linha ~254)
- Modify: `api/src/infra/config/configuration.ts` (bloco `fiscal`, linha ~110)
- Create: `api/src/shared/rollout/rollout-flags.service.ts`, `api/src/shared/rollout/rollout.module.ts` (global)
- Modify: `api/src/app.module.ts` (importar `RolloutModule`), `api/.env.example`
- Test: `api/src/shared/rollout/rollout-flags.service.spec.ts`, `api/src/infra/config/env.schema.spec.ts` (estender)

**Interfaces:**
- Produces:
  ```ts
  export type RolloutFlag = 'TAX_REGIME_RESTRICTION' | 'FISCAL_DPS_CONFORMANCE' | 'SIMPLES_TOTTRIB'
    | 'SIMPLES_RATE_MODE' | 'FISCAL_2027_SIMPLES_MEI' | 'CNPJ_REGISTRY_CHECK';
  class RolloutFlagsService {
    isOn(flag: Exclude<RolloutFlag, 'SIMPLES_RATE_MODE'>, tenantId: string): boolean;
    rateMode(tenantId: string): 'off' | 'warn' | 'block';
    rateEnforcedFrom(): string | null; // YYYY-MM-DD
  }
  ```

- [ ] **Step 1: Testes que falham** em `rollout-flags.service.spec.ts`: `defaults every flag to off`; `turns on for every tenant when the flag is on and no tenant list is set`; `limits to the listed tenants when <FLAG>_TENANTS is a UUID list`; `'*' means every tenant`; `rateMode returns warn or block only for allowed tenants`; `rateEnforcedFrom returns null when empty and rejects a malformed date`. Em `env.schema.spec.ts`: valor inválido de `SIMPLES_RATE_MODE` e `SIMPLES_RATE_ENFORCED_FROM=2026-13-99` falham a validação.
- [ ] **Step 2: Rodar** `cd api && npx jest src/shared/rollout src/infra/config` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar** as variáveis no zod (`booleanFromEnv.default(false)` para as `off|on`, `z.enum(['off','warn','block']).default('off')` para `SIMPLES_RATE_MODE`, `z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()` com preprocess de vazio para `undefined`, e uma `z.string().optional()` `<FLAG>_TENANTS` por flag), expor em `configuration.ts` sob a chave `rollout`, e implementar `RolloutFlagsService` lendo `ConfigService`. Documentar todas em `.env.example` com `off`.
- [ ] **Step 4: Rodar** os mesmos testes → PASS; `npx tsc --noEmit -p .` sem erros novos.
- [ ] **Step 5: Commit** `feat(config): flags de rollout por ambiente com canário por tenant`

### Task 2: Suíte de conformidade do Anexo I

**Files:**
- Create: `api/src/modules/invoice/domain/fiscal/dps/anexo1-conformance.spec.ts`
- Create: `api/src/modules/invoice/domain/fiscal/dps/anexo1-rules.ts` (a lista de `cTribNac` da dedução e constantes dos códigos de erro)

**Interfaces:**
- Produces: `export const DEDUCTION_ALLOWED_CTRIBNAC: ReadonlySet<string>` (a lista exata das Global Constraints) e `export const ANEXO1 = { E0436: '...', ... }` (apenas descrições, para nomear os testes).

- [ ] **Step 1: Escrever a suíte** com um `describe.each([['MEI'], ['SIMPLES_NACIONAL']])` e um `it` nomeado pelo código da regra, montando o DPS real com `DpsBuilder` (ver `dps-builder.spec.ts` para o fixture): `E0436 MEI nunca leva vDedRed`; `E0441/E0442 ME/EPP só leva vDedRed nos cTribNac permitidos`; `E0583 MEI nunca tem tpRetISSQN diferente de 1`; `E0600 MEI nunca leva pAliq`; `E0534 MEI nunca leva benefício municipal`; `E0162 MEI não leva regApTribSN`; `E0166 ME/EPP sempre leva regApTribSN`; `E0174 e E0175 regEspTrib é 0`; `E0710 MEI sem pTotTribSN`; `E0712 ME/EPP sem indTotTrib`. Os casos que o código atual viola (E0436, E0441/E0442, E0583) rodam com `FISCAL_DPS_CONFORMANCE` ligada via o mecanismo da Task 1 e devem **falhar** agora.
- [ ] **Step 2: Rodar** `npx jest src/modules/invoice/domain/fiscal/dps/anexo1-conformance.spec.ts` → falham E0436, E0441/E0442, E0583; os demais passam. Registrar quais falharam.
- [ ] **Step 3: Criar `anexo1-rules.ts`** com a lista e as constantes (só o necessário para a suíte compilar).
- [ ] **Step 4: Commit** `test(fiscal): suíte de conformidade do Anexo I (falhando onde há violação)`

### Task 3: Dedução proibida por regime (E0436, E0441, E0442)

**Files:**
- Create: `api/src/modules/invoice/domain/fiscal/validation/deduction-policy.ts`
- Modify: `api/src/modules/invoice/application/invoice-intake.service.ts` (recusa síncrona), `api/src/modules/invoice/domain/fiscal/validation/fiscal-validator.ts` (defesa em profundidade)
- Test: `deduction-policy.spec.ts`, `invoice-intake.service.spec.ts` (estender), `fiscal-validator.spec.ts` (estender)

**Interfaces:**
- Consumes: `IFiscalProfileReader.findEffectiveByDate(companyId, tenantId, date)`, `DEDUCTION_ALLOWED_CTRIBNAC`, `RolloutFlagsService.isOn('FISCAL_DPS_CONFORMANCE', tenantId)`.
- Produces: `export function deductionAllowed(input: { taxRegime: TaxRegimeKind; cTribNac: string; regApTribSN: 1 | 2 | 3 | null }): { allowed: true } | { allowed: false; code: 'DEDUCTION_NOT_ALLOWED_FOR_REGIME'; reason: string }`.

- [ ] **Step 1: Testes que falham:** `deduction-policy.spec.ts` (`MEI never allows a deduction`, `Simples with regApTribSN 1 allows only listed cTribNac`, `a deduction of zero is always allowed`); intake: `rejects a deduction for a MEI company with 422 before any credit is reserved`, `ignores the rule when FISCAL_DPS_CONFORMANCE is off`, `uses the profile effective on the competence date, not the current regime`, `is not applied to tenants outside <FLAG>_TENANTS`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** `deductionAllowed` como função pura; chamá-la no `InvoiceIntakeService.prepare` quando `deductionAmount > 0` e a flag está ligada para o tenant (lançar `FiscalValidationError` com `field: 'deduction'`, `code` mapeado para a família de erros existente); repetir no `FiscalValidator` como `TAX_CALCULATION_UNSUPPORTED`-compatível com `details.code = 'DEDUCTION_NOT_ALLOWED_FOR_REGIME'`.
- [ ] **Step 4: Rodar** os specs e a Task 2: `E0436` e `E0441/E0442` passam com a flag ligada. Rodar também `npx jest src/modules/invoice/http` e `src/modules/invoice/application/invoice-batch` para confirmar que o lote rejeita o item (a recusa passa por `prepareEmission` → `intake.prepare`).
- [ ] **Step 5: Commit** `fix(fiscal): dedução proibida para MEI e Simples fora da lista oficial (E0436, E0441, E0442)`

### Task 4: MEI sem retenção de ISS (E0583)

**Files:**
- Modify: `api/src/modules/invoice/application/fiscal/strategies/mei-tax.strategy.ts` e `common-obligations.ts`
- Test: `tax-strategy.spec.ts` (estender), suíte de conformidade (Task 2)

**Interfaces:**
- Consumes: `RolloutFlagsService`. A estratégia hoje recebe só `StrategyInput`; passar a flag por construtor (`MeiTaxStrategy` ganha `RolloutFlagsService`) e usar `input.invoice.tenantId`.

- [ ] **Step 1: Testes que falham:** `MEI with a CNPJ customer and a configured withholding has issWithheld NOT_APPLICABLE (E0583)` com a flag ligada; `with the flag off keeps REQUIRED`; `Simples keeps REQUIRED and still needs simplesIssRate`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** em `MeiTaxStrategy.plan`: sobrepor `issWithheld` por `{ status: 'NOT_APPLICABLE', reason: 'MEI não sofre retenção de ISS (E0583)' }` quando a flag está ligada.
- [ ] **Step 4: Rodar** `npx jest src/modules/invoice/application/fiscal` e a suíte de conformidade → `E0583` passa.
- [ ] **Step 5: Commit** `fix(fiscal): MEI não tem retenção de ISS (E0583)`

### Task 5: Campos proibidos ao MEI no DPS (E0600, E0534) e regime único

**Files:**
- Modify (somente se a suíte da Task 2 mostrar falha): `api/src/modules/invoice/domain/fiscal/dps/dps-builder.ts`, `api/src/infra/external/nfse/issue-params.ts`
- Test: suíte de conformidade

- [ ] **Step 1: Rodar** a suíte da Task 2. Se `E0600` ou `E0534` já passam, escrever no commit que nenhuma mudança foi necessária e seguir.
- [ ] **Step 2: Se falharem**, implementar a remoção do campo no builder para `opSimpNac = 2`, com teste dedicado, e rodar de novo.
- [ ] **Step 3: Commit** `test(fiscal): confirma E0600 e E0534 para MEI` (ou `fix(...)` se houve correção)

### Task 6: Recusar regimes que não sejam MEI ou Simples

**Files:**
- Modify: `api/src/modules/company/http/company.dto.ts` (`TAX_REGIMES`, validação condicionada à flag), `api/src/modules/company/application/company.service.ts` (create/update), `api/src/modules/company/domain/fiscal-profile.validator.ts`, `api/src/modules/invoice/application/fiscal/strategies/tax-strategy.resolver.ts` (bloqueio `TAX_REGIME_NOT_SUPPORTED`), `api/src/shared/http/api-error.ts` (`ERROR_TAX_REGIME_NOT_SUPPORTED`, 422), `api/src/modules/mcp/tools/company-create.tool.ts` (enum e descrição)
- Test: `company.service.spec.ts`, `company.dto.spec.ts` (criar se não existir), `tax-strategy.spec.ts`, `company-create.tool.spec.ts`, `api/test` e2e de empresas (estender o existente)

**Interfaces:**
- Consumes: `RolloutFlagsService.isOn('TAX_REGIME_RESTRICTION', tenantId)`.
- Produces: `class TaxRegimeNotSupportedError extends Error` (nome mapeado em `DOMAIN_ERRORS` para 422).

- [ ] **Step 1: Testes que falham:** `rejects Lucro Presumido, Lucro Real with 422 ERROR_TAX_REGIME_NOT_SUPPORTED when the flag is on`; `accepts MEI and Simples Nacional`; `accepts everything when the flag is off`; `PUT fiscal-profile rejects LUCRO_PRESUMIDO, LUCRO_REAL, OUTRO_REGIME and UNKNOWN with the flag on`; `engine blocks an unsupported regime with TAX_REGIME_NOT_SUPPORTED`; `company_create enum lists only MEI and Simples Nacional`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.** O `@IsIn(TAX_REGIMES)` do DTO continua aceitando os 4 valores (para a flag poder estar desligada); a recusa acontece no `CompanyService` e no validador do perfil fiscal quando a flag está ligada para o tenant. O `TaxStrategyResolver` devolve erro fiscal `TAX_REGIME_NOT_SUPPORTED` em vez de resolver `RegularTaxStrategy` quando a flag está ligada. A descrição da tool MCP passa a dizer "MEI or Simples Nacional" independentemente da flag.
- [ ] **Step 4: Rodar** `npx jest src/modules/company src/modules/invoice/application/fiscal src/modules/mcp` e o e2e de empresas.
- [ ] **Step 5: Commit** `feat(company): recusar regimes fora de MEI e Simples Nacional (flag TAX_REGIME_RESTRICTION)`

### Task 7: Runbook de liberação e auditoria de dados

**Files:**
- Create: `docs/fiscal/rollout-mei-simples.md`
- Create: `api/scripts/audit-tax-regimes.sql`

- [ ] **Step 1:** Escrever o runbook: ordem das flags (spec 7.1), o que observar entre passos (rejeições E0436, E0441, E0442, E0583, E0160), como reverter (desligar a flag e reiniciar) e como usar `*_TENANTS` para canário.
- [ ] **Step 2:** `audit-tax-regimes.sql`: `SELECT tenant_id, company_id, tax_regime FROM <schema>.company_fiscal_profiles WHERE tax_regime IN ('UNKNOWN','OUTRO_REGIME','LUCRO_PRESUMIDO','LUCRO_REAL')` (schema por parâmetro `psql -v`), usado antes de ligar `TAX_REGIME_RESTRICTION`.
- [ ] **Step 3: Commit** `docs(fiscal): runbook de liberação por flags e auditoria de regimes`

---

## Fase 1 — até meados de dezembro

### Task 8: Regime de apuração no perfil fiscal

**Files:**
- Create: migration `api/src/infra/database/migrations/1792500000000-AddFiscalProfileSimplesApuracao.ts`
- Modify: `api/src/modules/company/domain/fiscal-profile.ts` (campo `simplesApuracao: 'SN' | 'ISS_MUNICIPAL' | 'REGULAR'`), `company-fiscal-profile.orm-entity.ts`, `fiscal-profile.repository.ts`, `fiscal-profile.validator.ts`, `company.controller.ts` (PUT fiscal-profile aceita o campo), `company.service.ts` (default `'SN'`), DTO do perfil
- Test: `fiscal-profile.validator.spec.ts`, repositório Postgres, controller

**Interfaces:**
- Produces: `CompanyFiscalProfile.simplesApuracao` (padrão `'SN'`, `null` para MEI); `regApTribSNFor(profile): 1 | null`.

- [ ] **Step 1: Testes que falham:** `defaults to SN for Simples and null for MEI`; `rejects ISS_MUNICIPAL and REGULAR with 422 ERROR_SIMPLES_SUBLIMIT_NOT_SUPPORTED`; `rejects simplesApuracao for MEI`; migração aplica e reverte (teste de integração no padrão dos outros).
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** migração (coluna `simples_apuracao varchar` com CHECK em `('SN','ISS_MUNICIPAL','REGULAR')`, preenchendo `'SN'` para perfis `SIMPLES_NACIONAL`), entidade, validador e controller.
- [ ] **Step 4: Rodar** specs de company + integração.
- [ ] **Step 5: Commit** `feat(company): regime de apuração do Simples no perfil fiscal`

### Task 9: Tabela e API de alíquotas mensais do Simples

**Files:**
- Create: migration `1792510000000-CreateCompanySimplesRates.ts`; `api/src/modules/company/domain/simples-rate.ts`; `.../infra/simples-rate.orm-entity.ts`; `.../infra/typeorm-simples-rate.repository.ts`; `.../application/simples-rate.service.ts`; `.../http/simples-rate.controller.ts` (ou métodos no `company.controller.ts`); registrar no `company.module.ts`
- Test: specs de service e controller; `typeorm-simples-rate.repository.postgres.integration.spec.ts` (RLS como as demais tabelas por tenant)

**Interfaces:**
- Produces:
  ```ts
  type SimplesRate = { companyId: string; month: string /* YYYY-MM */; totalRate: string; issRate: string | null; ibsRate: string | null; cbsRate: string | null; updatedAt: Date };
  SimplesRateService.put(companyId, tenantId, environment, month, input): Promise<SimplesRate>;
  SimplesRateService.list(companyId, tenantId, environment): Promise<SimplesRate[]>;
  SimplesRateService.resolve(companyId, tenantId, environment, competenceDate): Promise<{ rate: SimplesRate | null; stale: boolean }>;
  // PUT /companies/:id/simples-rates/:month ; GET /companies/:id/simples-rates  (permissão nfse.companies.manage / .view)
  ```

- [ ] **Step 1: Testes que falham:** `put creates and replaces the same month`; `resolve returns the competence month when present`; `resolve repeats the closest previous month and marks stale after more than one month`; `resolve returns null when never informed`; `rejects a month in the future, a rate above 100 and more than 2 decimals`; `another tenant cannot read or write the rates (404)`; `ibsRate and cbsRate are accepted but optional`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** migração (PK `(company_id, month)`, `tenant_id`, `environment`, CHECKs de faixa, RLS no padrão das outras tabelas), repositório e serviço (`resolve` em uma query), endpoints com `@ApiKeyEndpoint()` e `@RequirePermission`.
- [ ] **Step 4: Rodar** specs + integração Postgres.
- [ ] **Step 5: Commit** `feat(company): alíquotas mensais do Simples por empresa`

### Task 10: `totTrib` e `regApTribSN` corretos no DPS

**Files:**
- Modify: `api/src/modules/invoice/domain/fiscal/dps/dps-builder.ts` (linha ~339, `vTotTrib` fixo), `api/src/infra/external/nfse/issue-params.ts` (linha ~43), `api/src/infra/external/nfse/nfse-fiscal-provider.ts` (tipo do payload: `valores.totTrib`), `api/src/modules/invoice/application/nfse-workflow.service.ts` (linha ~369, `regApTribSN` fixo; buscar a alíquota do mês)
- Test: suíte de conformidade (`E0710`, `E0712`, `E0166`), `issue-params.spec.ts`, `dps-builder.spec.ts`, `nfse-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `SimplesRateService.resolve`, `regApTribSNFor`, flag `SIMPLES_TOTTRIB`.
- Produces: `IIssuePayload.valores.totTrib: { kind: 'indTotTrib' } | { kind: 'pTotTribSN'; value: string } | { kind: 'vTotTrib' }`.

- [ ] **Step 1: Testes que falham** (flag ligada): `MEI sends indTotTrib 0 and never pTotTribSN`; `ME/EPP sends pTotTribSN from the resolved total rate and never indTotTrib`; `ME/EPP sends regApTribSN from the profile`; `flag off keeps the zeroed vTotTrib and regApTribSN 1`; `ME/EPP without any rate and the flag on fails with MISSING_CONFIGURATION (guarded by Task 11 mode)`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** o novo tipo de `totTrib` no payload, o ramo por regime em `issue-params.ts` e a busca da alíquota no `nfse-workflow.service.ts` (a alíquota **ausente** com a flag ligada não deve chegar aqui, pois a Task 11 recusa antes; se chegar, falhar com erro explícito em vez de enviar zero).
- [ ] **Step 4: Rodar** `npx jest src/infra/external/nfse src/modules/invoice` e a suíte de conformidade.
- [ ] **Step 5: Commit** `feat(fiscal): totTrib e regApTribSN corretos para MEI e Simples (flag SIMPLES_TOTTRIB)`

### Task 11: Exigência da alíquota (warn / block / data)

**Files:**
- Modify: `api/src/modules/invoice/application/invoice-intake.service.ts`, `api/src/modules/invoice/application/fiscal/steps/tax-applicability.step.ts` (defesa em profundidade), `api/src/modules/invoice/http/invoice-calculation-response.dto.ts` (warning `SIMPLES_RATE_STALE`)
- Test: `invoice-intake.service.spec.ts`, `tax-applicability.step.spec.ts`, e2e

**Interfaces:**
- Consumes: `RolloutFlagsService.rateMode/rateEnforcedFrom`, `SimplesRateService.resolve`.

- [ ] **Step 1: Testes que falham:** `mode off never asks for a rate`; `mode warn lets an ME/EPP without rate through and reports a warning`; `mode block refuses with 422 MISSING_CONFIGURATION and missingFields simplesRate.totalRate, before any credit reservation`; `no enforcement for competence before SIMPLES_RATE_ENFORCED_FROM`; `MEI never needs a rate`; `a rate older than one month adds SIMPLES_RATE_STALE`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** no intake (resolve da alíquota antes de montar o resultado) e repetir no motor.
- [ ] **Step 4: Rodar** specs de invoice e o lote (`src/modules/invoice/application/invoice-batch`): no lote, a recusa vira item `rejected`.
- [ ] **Step 5: Commit** `feat(fiscal): exigir a alíquota do Simples (flag SIMPLES_RATE_MODE)`

### Task 12: MCP — atualizar e ver a alíquota

**Files:**
- Create: `api/src/modules/mcp/tools/company-set-simples-rate.tool.ts` (+ spec)
- Modify: `api/src/modules/mcp/mcp.service.ts` (registrar com escopo `nfse:write`), `company-get.tool.ts`/`company-list.tool.ts` (mostrar a alíquota vigente e `rate_stale`)

**Interfaces:**
- Produces: tool `company_set_simples_rate` com entrada `{ company_tax_id | company_id, month: 'YYYY-MM', total_rate: number, iss_rate?: number }` e saída `{ company_id, month, total_rate, iss_rate }`.

- [ ] **Step 1: Testes que falham:** mapeia snake_case para `SimplesRateService.put`; recusa mês inválido; `company_get` mostra a alíquota vigente e `rate_stale: true` quando velha; e2e MCP atualiza e lê.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** `npx jest src/modules/mcp` e `test/mcp-tools.e2e-spec.ts` (atualizar a lista esperada de tools).
- [ ] **Step 5: Commit** `feat(mcp): company_set_simples_rate e alíquota vigente em company_get`

### Task 13: Web — formulário e alíquota

**Files:**
- Modify: `web/components/dashboard/company-form.tsx`, `web/lib/company-fiscal.ts`, `web/lib/types.ts`, `web/lib/api.ts`, `web/messages/en.json`, `web/messages/pt.json`; criar componente de alíquota no detalhe da empresa
- Test: `web/tests/company-fiscal.test.ts` e um teste do componente

- [ ] **Step 1: Testes que falham (vitest):** o formulário lista só MEI e Simples Nacional; o campo "Alíquota do Simples do mês" aparece só para Simples, mostra a data da última atualização e o aviso de valor antigo; MEI não mostra o campo.
- [ ] **Step 2: Rodar** `cd web && npx vitest run tests/company-fiscal.test.ts` → FAIL. **Step 3: Implementar.** **Step 4: Rodar** a suíte web e `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(web): só MEI e Simples e campo de alíquota do mês`

---

## Fase 2 — até 31/12/2026 (depende da NT 9/2026)

### Task 14: Ler a NT 9/2026 e fechar o desenho de 2027

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-mei-simples-focus-design.md` (seção 6.4 e 10.2)

- [ ] **Step 1:** Obter a NT SE/CGNFS-e 9/2026 e o XSD que contém `regApIBSCBSSN`, `vReceitaBrutaSN` e `gTribSN` (página de documentação técnica do portal NFS-e). Se não estiverem publicados, **parar aqui e avisar o dono do produto**: as Tasks 15 e 16 não podem ser escritas.
- [ ] **Step 2:** Registrar na seção 6.4 o texto exato das regras, o que o MEI informa em 2027 e como arredondar IBS e CBS; conferir se a `open-nfse` gera os campos (`grep` nos tipos da lib; se não gerar, decidir entre atualizar a lib e estender o builder).
- [ ] **Step 3: Commit** `docs: desenho de 2027 fechado com a NT 9/2026`

### Task 15 e Task 16: IBS/CBS de 2027 para Simples e para MEI (a detalhar após a Task 14)

Estas duas tarefas ficam **intencionalmente sem passos** até a Task 14 terminar, porque as regras do grupo `IBSCBS` para optantes ainda não foram lidas na fonte oficial. Escopo já decidido: grupo `IBSCBS` com `regApIBSCBSSN` 1 e 3 (2 bloqueado), `ibs_rate` e `cbs_rate` vindos de `company_simples_rates`, tudo atrás de `FISCAL_2027_SIMPLES_MEI`, e com a flag desligada a competência de 2027 continua bloqueada com `TAX_CALCULATION_UNSUPPORTED`. O plano é completado com passos de TDD logo após a Task 14.

---

## Fase 3

### Task 17: Conferência de regime e município no cadastro (aviso)

**Files:**
- Create: `api/src/modules/company/domain/simples-registry.port.ts`, `api/src/infra/external/cnpj/brasilapi-simples-registry.adapter.ts` (ou ReceitaWS, o construtor verifica antes), cache de 24 h
- Modify: `company.service.ts` (só no create), resposta de criação com `warnings`
- Test: adapter com HTTP mockado, service

**Interfaces:**
- Produces: `abstract class SimplesRegistryPort { lookup(cnpj: string, date: string): Promise<{ optanteSimples: boolean | null; optanteMei: boolean | null; municipalityCode: string | null } | null> }`.

- [ ] **Step 1: Testes que falham:** `warns TAX_REGIME_REGISTRY_MISMATCH when the registry contradicts the informed regime`; `warns MEI_MUNICIPALITY_MISMATCH`; `a failing or slow registry never blocks and never warns`; `flag off performs no call`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** com timeout curto e cache. **Step 4: Rodar** specs.
- [ ] **Step 5: Commit** `feat(company): aviso de divergência com o cadastro público de CNPJ (flag CNPJ_REGISTRY_CHECK)`

### Task 18: Documentação, OpenAPI, site e llms.txt

**Files:**
- Modify: `web/lib/docs/content/en.ts` e `pt.ts`, `web/messages/*.json`, `web/components/landing/*`, `api/llms.txt`, `web/public/llms.txt`, `api/FRONTEND_API.md`, `api/README.md`, descrições do OpenAPI nos controllers
- Test: `web/tests/docs-parity.test.ts` (estender: sem menção a "Lucro Presumido"/"Lucro Real" fora de avisos, endpoints novos de alíquota presentes em EN e PT)

- [ ] **Step 1: Testes que falham** (paridade EN/PT e ausência dos termos). **Step 2: Rodar** `cd web && npx vitest run` → FAIL.
- [ ] **Step 3: Escrever** as páginas: "Simples Nacional: alíquotas" (como informar, mensalmente, por API/MCP/painel), "Não geramos DAS", erros novos, endpoints `simples-rates`.
- [ ] **Step 4: Rodar** a suíte web inteira. **Step 5: Commit** `docs: só MEI e Simples Nacional, alíquotas e novos erros`

### Task 19: Limpeza de flags (uma por PR, depois de ligadas para todos sem incidentes)

Fora da execução inicial: para cada flag estável, remover a flag, o ramo antigo e os testes do estado desligado. Registrar no runbook (Task 7) a data de cada remoção.
