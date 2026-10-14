# Spec 2 — Núcleo da FiscalEngine (pipeline, perfis, cálculo)

Data: 2026-10-13 · Status: rascunho para revisão · Depende de: Spec 1 (outbox) · Escopo: `api/`

Cobre as Partes I, II, III (exceto DpsBuilder), IV (persistência e DTO) e VI do briefing. DpsBuilder, Calculadora RTC real e conciliação ficam no Spec 3; preview e documentação no Spec 4.

## 1. Objetivo

Criar a FiscalEngine: um pipeline **puro e determinístico** que, dado uma invoice normalizada, resolve perfil fiscal, classificação, aplicabilidade, ISS/retenções e (via port) IBS/CBS, e devolve um `FiscalCalculationResult` imutável ou um `FiscalError` tipado. A engine **calcula e valida; não transmite**. A transmissão continua no `NfseWorkflowService`.

## 2. Decisões herdadas e confirmadas

- A engine roda no handler de outbox `invoice.calculate_taxes` (ponto de extensão do Spec 1). Ao concluir, grava snapshot e a mensagem `invoice.emit` na mesma transação.
- Erro fiscal **não retryable** (VALIDATION, CONFIGURATION, CLASSIFICATION, UNSUPPORTED, INTERNAL de invariante) → invoice `rejected` com `lastErrorCode FISCAL_*`/`TAX_*`, webhook `nfse.invoice.rejected`, reembolso do crédito pelo fluxo atual. Sem status novo.
- Erro **retryable** (INTEGRATION: RTC indisponível) → o handler lança, a outbox reentrega com backoff até `OUTBOX_MAX_ATTEMPTS`; esgotado → `rejected` com `TAX_CALCULATION_UNAVAILABLE`.
- Feature flag `FISCAL_ENGINE_ENABLED` (env.schema, padrão `false`), lida **no intake**: ligada, `submit()` grava `invoice.calculate_taxes`; desligada, grava `invoice.emit` direto (comportamento atual). A flag vale por invoice no momento da criação, então ligar/desligar não afeta mensagens em voo.
- Lógica fiscal no **domínio de `invoice`** (pedido explícito do usuário), e não em `modules/fiscal` como no esboço do briefing.

## 3. Estrutura

```
modules/invoice/
  domain/fiscal/                      # puro: sem Nest, ORM, HTTP, SDK
    result.ts                         # Result<T,E>, ok(), err()
    fiscal-error.ts                   # FiscalError, FiscalErrorCode, categorias
    fiscal-context.ts                 # FiscalContext (imutável), FiscalWarning
    fiscal-step.ts                    # FiscalStep, StepOutcome
    fiscal-pipeline.ts                # executor
    fiscal-calculation-result.ts
    money.ts                          # helpers Decimal (strings decimais)
    profile/                          # CompanyFiscalProfile, regimes, vigência
    classification/                   # ServiceTaxClassification, ports de catálogo
    applicability/                    # TaxApplicability, specifications
    strategies/                       # MeiTax, SimplesNacionalTax, RegularTax
    policies/                         # TaxTransitionPolicy + RuleVersion
    legacy/                           # IssTaxResolver, retenções
    rtc/                              # RtcCalculatorPort + tipos (sem implementação real)
  application/fiscal/
    fiscal-engine.service.ts          # monta contexto, roda pipeline, devolve resultado
    calculate-taxes.handler.ts        # OutboxHandler 'invoice.calculate_taxes'
    steps/*.step.ts                   # 1 arquivo por etapa, injetável (Nest)
    fiscal-profile.service.ts         # CRUD de perfis (admin)
  infra/fiscal/                       # entidades, repositórios, fake RTC
```

Domínio não importa de `application`/`infra`. Etapas em `application/fiscal/steps` são classes Nest que delegam a lógica pura do domínio e recebem ports por injeção.

## 4. Contratos centrais

- `Result<T, E> = {ok:true,value:T} | {ok:false,error:E}`; sem exceptions para falhas esperadas. Adapters traduzem erros conhecidos do SDK/HTTP para `FiscalError` e preservam a causa em `details.cause` (string, sem stack) e no log.
- `FiscalError { code, message, step, details, retryable, category }`; `category ∈ VALIDATION | CONFIGURATION | CLASSIFICATION | CALCULATION | INTEGRATION | UNSUPPORTED | INTERNAL`. `retryable = true` só para INTEGRATION segura.
- Códigos: `FISCAL_PROFILE_MISSING`, `FISCAL_PROFILE_NOT_EFFECTIVE`, `FISCAL_CLASSIFICATION_REQUIRED|INVALID|AMBIGUOUS`, `TAX_APPLICABILITY_UNKNOWN`, `TAX_REGIME_UNSUPPORTED`, `TAX_RATE_NOT_FOUND`, `TAX_CALCULATION_UNAVAILABLE|UNSUPPORTED`, `TAX_RULE_NOT_EFFECTIVE`, `FISCAL_VALIDATION_FAILED`, `FISCAL_REVIEW_REQUIRED`, `OPERATION_DOCUMENT_UNSUPPORTED`; `DPS_*` e `TAX_RECONCILIATION_REQUIRED` são do Spec 3.
- `FiscalStep { readonly name; execute(ctx: Readonly<FiscalContext>): Promise<Result<StepOutcome, FiscalError>> }`, `StepOutcome = {status:'applied', context} | {status:'skipped', context, reason}`.
- `FiscalContext` tipado (invoice normalizada, `companyProfile?`, `classification?`, `applicability?`, `legacyTaxes?`, `rtcTaxes?`, `warnings`, `trace`). Cada etapa valida pré-condições e devolve erro de invariante (`INTERNAL`) em vez de `!`. Contexto é copiado a cada etapa (`Object.freeze` nas bordas, sem mutação).
- `FiscalPipeline`: lista **explícita e ordenada** injetada por um provider de fábrica (token `FISCAL_STEPS`), sem encadeamento dinâmico, sem paralelismo, fail-fast. Registra no `trace` cada etapa (`applied|skipped|failed`, duração, motivo) e emite métricas. `skipped` só é aceito para etapas marcadas como opcionais; uma etapa obrigatória que devolva `skipped` vira `INTERNAL`.
- Singletons não guardam estado de requisição; todo estado vive em `FiscalContext`.
- `FiscalCalculationResult` imutável: conforme Parte III §14, mais `trace` e `rulesVersion`. Valores como **strings decimais**; aritmética com `Decimal` (`shared/types/money.ts`); alíquotas com precisão total; arredondamento por tributo definido na regra (modo e casas na `RuleVersion`).

## 5. Etapas (ordem fixa)

1. **CompanyFiscalProfileResolver** (obrigatória). Resolve o perfil vigente **na data do fato gerador** (`competenceDate`) por `company_fiscal_profiles`. Ausente → `FISCAL_PROFILE_MISSING`; sem registro vigente na data → `FISCAL_PROFILE_NOT_EFFECTIVE`. Em `live` exige `reviewStatus = approved`; em `test` aceita não revisado com warning.
2. **ServiceTaxClassifier** (obrigatória). Prioridade: (1) `service.fiscal` explícito, validado e auditado (`source = request_override`); (2) `serviceProfileId`/perfil aprovado da empresa para o `cTribNac` (`company_service_tax_profiles` vigente na data); (3) correlação oficial **inequívoca** do catálogo; (4) `FISCAL_CLASSIFICATION_REQUIRED` com `details.missingFields`. Mais de um candidato → `FISCAL_CLASSIFICATION_AMBIGUOUS` (nunca a primeira). CNAE só sugere em UI, nunca decide. Valida: formato e existência do `cTribNac`; coerência CST × cClassTrib × cIndOp contra o catálogo **quando houver versão de catálogo importada**; sem catálogo, os códigos ficam `catalogValidated=false` e a etapa de aplicabilidade bloqueia se IBS/CBS for `Required`.
3. **TaxApplicabilityResolver** (obrigatória). Para cada tributo (ISS, ISS retido, PIS/Cofins, retenções federais, CBS, IBS-UF, IBS-Mun, regra especial) decide `Required | NotApplicable | Unsupported | MissingConfiguration`, com razão estruturada. `Unsupported` nunca vira `NotApplicable`: bloqueia a emissão (`TAX_CALCULATION_UNSUPPORTED`). `MissingConfiguration` → `TAX_APPLICABILITY_UNKNOWN`/`TAX_RATE_NOT_FOUND`. Usa a `TaxTransitionPolicy` e as Specifications (§7). Também decide **tomador**: sem `customer`, só passa se `AllowsAnonymousCustomerSpecification` for satisfeita; senão `FISCAL_VALIDATION_FAILED` com campo `customer`.
4. **LegacyTaxCalculator** (opcional). `skipped` com motivo quando ISS/retenções são `NotApplicable` (ex.: ISS dentro do DAS no Simples/MEI). Componentes: `IssTaxResolver`, `PisCofinsTaxResolver`, `FederalWithholdingResolver`, `SocialSecurityWithholdingResolver`. Só calcula com alíquota e base **configuradas e vigentes** (perfil/parâmetros municipais); nunca default. Separa ISS apurado, retido, informado e responsável tributário. Retenções que dependem de dado ausente → `MissingConfiguration`/`Unsupported`, nunca presumidas. Município de incidência vem do perfil/regra, não do `municipalityCode` do cliente sozinho.
5. **RtcTaxCalculator** (opcional). `skipped` quando CBS/IBS são `NotApplicable` (ex.: MEI; Simples em 2026) ou antes da vigência da obrigação, registrando o motivo. Quando `Required`, chama `RtcCalculatorPort` (§8). Resultado inválido (inconsistente com a base, componentes que não somam) → `CALCULATION`, não retryable.
6. **FiscalValidator** (obrigatória). Revalida o contexto final: perfil, código, consistência de classificação, regime × tributos calculados, bases, reduções, retenções, precisão/arredondamento, requisitos da competência. Separa `errors` (bloqueiam) de `warnings`.
7. **FiscalCalculationResultBuilder** (fim do pipeline, não é `FiscalStep`): monta o resultado imutável e o `FiscalSnapshotDraft`.

## 6. Estratégias (Strategy)

`TaxStrategy { supports(profile, classification, competence): boolean; plan(ctx): Result<TaxPlan, FiscalError> }`, com `MeiTaxStrategy`, `SimplesNacionalTaxStrategy`, `RegularTaxStrategy` e ponto para `SpecialTaxStrategy`. O `TaxStrategyResolver` escolhe **exatamente uma**; zero ou mais de uma que suporte → `TAX_REGIME_UNSUPPORTED`. A estratégia define o *plano* (quais cálculos e quais fontes), não fórmulas: ISS/IBS/CBS vêm de dados configurados e da Calculadora. Simples: não infere alíquota do DAS; registra a opção de IBS/CBS pelo regime regular (perfil, `simpleNationalIbsCbsRegular`) quando válida na competência. Regime `UNKNOWN`/`OUTRO_REGIME` → `TAX_REGIME_UNSUPPORTED`.

## 7. Specifications e TaxTransitionPolicy

Specifications só onde há composição real: `RequiresIbsCbsSpecification`, `RequiresIssWithholdingSpecification`, `AllowsAnonymousCustomerSpecification`, `RequiresSpecialTaxTreatmentSpecification`. Cada uma devolve `{satisfied, reason}`. Regime (MEI/Simples) é decidido pela Strategy, não por Specifications triviais.

`TaxTransitionPolicy` é **regra versionada como código tipado**, não `if (year…)` e não tabela editável (regra tributária só muda por PR revisado e testado): cada `TaxRule` em `domain/fiscal/policies/rules/` declara `ruleKey`, `validFrom/validUntil`, `legalReference`, `parameters` tipados, `status` (`published|homologated|in_production`) e `sourceUrl`; o conjunto tem um `rulesVersion` (ex.: `2026.10-r1`) gravado no snapshot. Seleção determinística por `(ruleKey, data do fato gerador)`; adicionar regra = adicionar entrada, sem migration; sem regra vigente → `TAX_RULE_NOT_EFFECTIVE`. Parâmetros por regra (exemplos do briefing, a serem carregados com fundamento normativo conferido no plano):
- 2026: teste CBS 0,9% / IBS 0,1% para operações sujeitas; distinção calculado × destacado × a recolher; dispensa de recolhimento como atributo da regra; Simples excluído antes de 01/01/2027.
- Marcos de informação na NFS-e: 01/10/2026 (regra geral ISS) e 01/12/2026 (categorias do Ato Conjunto RFB/CGIBS 4/2026); tolerância da Sefin até 31/12/2026 registrada como `sefinToleranceUntil`, **sem** tratá-la como dispensa.
- 2027–2028, 2029–2032 (transição ISS/ICMS→IBS) e 2033: só chaves e estrutura; **sem alíquotas estimadas**. Competência sem regra publicada → `TAX_RULE_NOT_EFFECTIVE`, não presunção.

Decisão em aberto D1 (ver §13): comportamento quando IBS/CBS é `Required`, a tolerância da Sefin vale, mas o RTC real ainda não existe.

## 8. Port da Calculadora RTC (somente contrato)

`RtcCalculatorPort { health(); version(); calculate(input): Promise<Result<RtcTaxResult, FiscalError>> }` em `domain/fiscal/rtc`, com `RtcTaxResult` (CBS, IBS-UF, IBS-Mun, IBS total, bases, alíquotas nominal/efetiva, reduções, diferimentos, ajustes, fundamentação legal, memória de cálculo, `calculatorVersion`). Neste spec há `FakeRtcCalculator` (para testes) e um `UnconfiguredRtcCalculator` que devolve `TAX_CALCULATION_UNAVAILABLE` (`details.reason = 'adapter_not_configured'`, `retryable = false`). O adapter real, contrato HTTP e deploy são do Spec 3.

## 9. Dados

Novas tabelas (schema `corvo`, migrations TypeORM). Tabelas por empresa entram em `TENANT_RLS_TABLES`; catálogos e regras são globais (sem tenant, somente leitura para a aplicação).

- `company_fiscal_profiles` — **só o que muda com o tempo**: `id, tenant_id, company_id, environment, tax_regime (MEI|SIMPLES_NACIONAL|LUCRO_PRESUMIDO|LUCRO_REAL|OUTRO_REGIME|UNKNOWN), simple_national (bool), special_tax_regime, ibs_cbs_regular_option (bool) + ibs_cbs_regular_from (date, opção do Simples pelo regime regular), valid_from, valid_until, source, review_status, reviewed_by, reviewed_at, created_at`. Identidade e localização (`municipal_reg`, `municipality_code`, `default_service_code`, endereço, certificado) **permanecem em `nfse_companies`**. Vigência sem sobreposição por empresa/ambiente (`EXCLUDE USING gist` com `daterange`, requer `btree_gist`; sem a extensão, verificação na transação com lock da empresa). **Append-only**: mudança de regime fecha a vigência anterior e cria nova linha. É a **única fonte** de regime: `tax_regime`, `simple_national` e `special_regime` são removidos de `nfse_companies`; `CompanyService`/DTO da company continuam aceitando esses campos e a escrita cria uma nova vigência (mesma data de corte, `source = company_api`), a leitura devolve o perfil vigente.
- `company_service_tax_profiles` — catálogo de serviços da empresa (conceito novo; `default_service_code` só comporta um): `id, tenant_id, company_id, name, service_code (cTribNac), municipal_service_code, nbs_code, cst, class_code, operation_indicator, regime_applicability[], incidence_municipality_code, iss_rate (numeric, nullable), iss_taxation (normal|fixed|exempt|…, a fechar com a LC 116), iss_withholding_default (bool), effective_from/until, classification_source, review_status, catalog_version (texto), created_at`. A **alíquota de ISS e o padrão de retenção vivem aqui** (variam por serviço e município, não por empresa) e substituem o `iss_parameters jsonb` do rascunho anterior. `default_service_code` da company aponta para o `service_code` de um destes perfis.
- **Catálogos oficiais não são tabelas.** cTribNac (e, no Spec 3, NBS/CST/cClassTrib/cIndOp) ficam em arquivos versionados no repositório (`domain/fiscal/catalog/data/*.json`) com `version`, `sourceUrl`, `publishedAt` e `checksum`, gerados por script a partir da fonte oficial e revisados em PR. O snapshot grava versão e checksum usados. Tabela de catálogo só se o Spec 3 provar necessidade de atualização em runtime.
- **Regras de transição não são tabela** (§7): código tipado versionado no git.
- `invoice_fiscal_snapshots` (tabela própria, e não a coluna `tax_snapshot` da invoice, por: imutabilidade via trigger, payload grande que não deve pesar na linha paginada, relação 1:1): `invoice_id (unique), tenant_id, company_id, tax_regime, profile_id, service_profile_id?, classification jsonb, classification_source, taxable_amounts jsonb, calculated_taxes jsonb, withholdings jsonb, applicability jsonb, trace jsonb, calculation_source, calculator_version, catalog_versions jsonb, rules_version, legal_references jsonb, warnings jsonb, calculated_at`. **Imutável** (trigger bloqueia `UPDATE`/`DELETE`). Valores autorizados e divergências ficam em tabela própria do Spec 3, sem tocar no snapshot.
- Índices: `company_id`, `(company_id, valid_from, valid_until)`, `service_code`, `(kind, version)`, `(rule_key, valid_from)`, `invoice_id`.
- Migração de dados: para cada empresa existente, cria o perfil inicial a partir de `nfse_companies.tax_regime/simple_national/special_regime` (`source = company_legacy`, `review_status = unreviewed`, `valid_from` = `created_at` da empresa) e depois remove essas colunas da company. Como não há produção, serve a dev/teste. Com isso, as tabelas fiscais novas deste spec são **duas** (`company_fiscal_profiles`, `company_service_tax_profiles`) mais `invoice_fiscal_snapshots`.
- `nfse_invoices`: sem alteração de colunas além das do Spec 1; `taxSnapshot` (jsonb existente) passa a guardar apenas referência (`snapshotId`, `rulesVersion`).

## 10. API e DTO

Aditivos e opcionais; contrato atual intacto.
- `service.fiscal?: { nbsCode?, cst?, classCode?, operationIndicator? }` (formato estrutural no DTO; coerência na engine, com override auditado em `classification_source = request_override`).
- `service.serviceProfileId?: uuid` (referência ao catálogo da empresa).
- `customer` opcional; `customer.address.municipalityCode?` (7 dígitos IBGE).
- `customer.taxId`: string, aceitando CNPJ alfanumérico (`shared/fiscal/cnpj.ts` ajustado se necessário, validando DV alfanumérico).
- O `normalizeAndValidate` deixa de **fabricar** tomador (`'Consumidor'`, cidade `'SIM'`, UF `'SS'`) quando a engine está ligada; ausência de tomador vira `customer: null`, decidida pela engine. Com a flag desligada, comportamento atual preservado.
- `amount: number` continua; a conversão para `Decimal` ocorre uma vez na normalização, exata (via string, rejeitando mais de 2 casas).
- Endpoints de administração fiscal (autenticados, permissão nova no catálogo, rate-limited): `GET/PUT /v1/companies/:id/fiscal-profile` (append-only com vigência) e `GET/POST/PATCH /v1/companies/:id/fiscal-services`. Swagger, `FRONTEND_API.md` e `llms.txt` atualizados.
- Erros: como o `POST /v1/invoices` é assíncrono, `FISCAL_*` aparecem em `lastErrorCode`/webhook; o mapeamento HTTP 422 (`{error:{code,message,fields}}`) vale para os endpoints síncronos (admin e preview, Spec 4). Sem stack no cliente.

## 11. Integração com o fluxo existente

- `VALID_TRANSITIONS`: adicionar `queued → rejected` (erro fiscal antes de processar). Demais transições intactas.
- `calculate-taxes.handler`: carrega invoice (escopo do tenant), roda `FiscalEngineService`; sucesso → transação {snapshot + `invoice.emit`}; falha não retryable → `lifecycle.transition(rejected)` + webhook; retryable → lança.
- `NfseWorkflowService.payload()`: com a flag ligada, `emitente.regime`, `cTribNac` e demais dados derivam do **snapshot**, e não de `company.taxRegime` atual (corrige o uso do perfil de hoje para notas antigas). O grupo IBS/CBS da DPS entra no Spec 3; aqui o DPS continua sem ele, e a engine só permite emitir quando IBS/CBS for `NotApplicable`/pré-vigência ou a tolerância D1 estiver ativa.
- Idempotência, sequência DPS, retries e reconciliação **não mudam**.
- `SCHEDULE`: a engine roda na data de liberação, então usa regras e perfil vigentes na competência.

## 12. Observabilidade e testes

Métricas: `fiscal_pipeline_duration`, `fiscal_step_duration`, `fiscal_step_failed_total`, `fiscal_step_skipped_total`, `fiscal_review_required_total`, `fiscal_classification_failure_total`. Logs estruturados com correlation id, `invoiceId`, `companyId`, `step`, `status`, `errorCode`, duração, versões de regra e catálogo; sem documentos completos nem XML.

Testes (Jest; Postgres para persistência e RLS):
- Pipeline: ordem, fail-fast, nenhuma etapa após erro, propagação de erro e de contexto, `skipped` explícito, obrigatória não ignorável, isolamento entre execuções concorrentes (`Promise.all` com contextos distintos), pureza (contexto de entrada não mutado).
- Perfil: ausente, não vigente, mudança de regime com vigência, nota antiga usa perfil antigo, `unreviewed` em `live`.
- Classificador: prioridade 1→4, ambígua, override auditado, CST × cClassTrib incompatível, cIndOp incompatível.
- Aplicabilidade: `NotApplicable` × `Unsupported` × `MissingConfiguration`; MEI sem IBS/CBS; Simples 2026 sem alíquota de teste; regime regular 2026 e 2027 (com fake RTC); tomador ausente permitido/exigido.
- Cálculo: ISS com alíquota configurada, ISS retido, município de incidência ≠ sede, mudança de alíquota por vigência, desconto incondicional, redução de alíquota, arredondamentos e limites; sem alíquota → `TAX_RATE_NOT_FOUND`; produto físico → `OPERATION_DOCUMENT_UNSUPPORTED`; salão-parceiro → `FISCAL_REVIEW_REQUIRED`.
- Handler/outbox: sucesso grava snapshot + `invoice.emit` atomicamente; erro não retryable → `rejected` e reembolso; RTC indisponível → retry; snapshot imutável (trigger); competência passada após atualização de regras reproduz o snapshot.
- Fixtures: códigos fiscais só de catálogo oficial importado ou de fixture revisada com origem documentada; **proibido** usar os placeholders `*_VALIDADO` do briefing. Testes puros de pipeline usam stubs de step sem códigos fiscais reais.

## 13. Decisões em aberto para revisão

- **D1 — Tolerância IBS/CBS até o RTC real existir.** Padrão proposto `FISCAL_IBSCBS_UNAVAILABLE_MODE=block`: regime regular com IBS/CBS `Required` é rejeitado com `TAX_CALCULATION_UNAVAILABLE` (não emite DPS fiscalmente incompleta). Alternativa `warn`: emite sem o grupo enquanto vigorar `sefinToleranceUntil` (31/12/2026), marcando `requiresReview` e métrica. MEI e Simples (barbearias do exemplo) não são afetados em nenhum dos modos.
- **D2 — Revisão de perfil em `live`.** Proposta: exigir `approved`. Quem aprova (usuário do tenant com permissão, ou Corvo) precisa ser definido.
- **D3 — Fonte e formato do catálogo cTribNac** serão confirmados ao inspecionar o arquivo oficial no início do plano; o script gerador e o JSON resultante são o entregável.
- **D4 — Parâmetros de transição** (alíquotas, datas e prazos) só entram com referência normativa conferida (LC 214/2025, LC 227/2026, Ato Conjunto 4/2026); o plano reserva uma tarefa de conferência jurídica antes de carregar as regras em `domain/fiscal/policies/rules/`.

## 14. Fora de escopo

RTC real, DpsBuilder IBS/CBS, conciliação, preview, NT 009, cancelamento de agendamento, salão-parceiro e NF-e/NFC-e (apenas detectados e bloqueados com erro explícito).
