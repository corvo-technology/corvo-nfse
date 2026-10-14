# Núcleo da FiscalEngine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a FiscalEngine (pipeline Result-based de 6 etapas) que resolve perfil fiscal, classificação, aplicabilidade, ISS/retenções e IBS/CBS (via port), rodando no handler de outbox `invoice.calculate_taxes`, com snapshot fiscal imutável.

**Architecture:** Lógica pura no domínio de `invoice` (`modules/invoice/domain/fiscal/**`, sem Nest/ORM/SDK). Perfis fiscais e catálogo de serviços são dados da empresa e vivem em `modules/company` (tabelas + serviço); a engine os lê por ports definidos no domínio de `invoice`. Regras de transição e catálogos oficiais são código/JSON versionado no git (sem tabelas). Etapas são classes Nest finas que delegam ao domínio. O pipeline calcula e valida; a transmissão continua no `NfseWorkflowService`.

**Tech Stack:** NestJS 11, TypeORM 0.3 + PostgreSQL (RLS), BullMQ, decimal.js (`@/shared/types/money`), luxon, Jest.

**Spec:** `docs/superpowers/specs/2026-10-13-fiscal-engine-core-design.md` (depende do plano `2026-10-13-outbox-intake-schedule.md` já executado).

## Global Constraints

- Trabalhar em `api/`; branch `feat/fiscal-engine-core` a partir de `feat/outbox-intake` (ou `main` após merge). Nunca commitar na `main`.
- Caminhos com prefixo `api/`, `docs/` ou `deploy/` são relativos à **raiz do repositório**; todos os demais (`src/`, `test/`, `scripts/`, `nest-cli.json`) são relativos a `api/`. Comandos `yarn` rodam em `api/`.
- Aritmética tributária **somente** com `Decimal`; valores monetários e alíquotas trafegam como **strings decimais**; `number` só na borda do DTO. Alíquotas em **percentual** (`"0.9"` = 0,9%). Arredondamento monetário: `ROUND_HALF_UP`, 2 casas, só no valor final de cada tributo.
- Domínio (`domain/fiscal/**`) não importa `@nestjs/*`, `typeorm`, `open-nfse` nem HTTP.
- Falhas fiscais esperadas são `Result`, nunca `throw`. `throw` só para bug/infra (a outbox reentrega).
- Nenhuma alíquota, classificação ou benefício presumido. Sem `any`; sem non-null assertion para esconder pré-condição.
- Fixtures: códigos de serviço (`060101`, `060201`, `010601`) vêm do catálogo oficial; NBS/CST/cClassTrib/cIndOp **sintéticos** só em testes unitários puros, importados de `test/fixtures/synthetic-fiscal-codes.ts`, nunca em integração, XML ou produção. Os placeholders `*_VALIDADO` do briefing são proibidos.
- Feature flag `FISCAL_ENGINE_ENABLED` (padrão `false`), lida no intake. Com a flag desligada o comportamento atual permanece integralmente.
- Erro fiscal não retryable ⇒ invoice `rejected` com `lastErrorCode` = código do `FiscalError` (≤ 50 chars). Erro retryable (`INTEGRATION`) ⇒ o handler lança e a outbox reentrega; ao esgotar tentativas ⇒ `rejected` `TAX_CALCULATION_UNAVAILABLE`.
- Migrations: schema `corvo` (`runner.connection.options.schema ?? 'corvo'`), RLS idêntica às existentes, timestamps após `1791770000000`.
- Testes de Postgres só com `MIGRATION_TEST_DATABASE_URL` (`*_test`, local).

## Desvios deliberados do spec (aceitos neste plano)

1. Persistência/serviço de perfil fiscal e de catálogo de serviços ficam em `modules/company` (dados da empresa), não no domínio de `invoice`; evita ciclo `invoice ↔ company`. A engine usa os ports `FISCAL_PROFILE_READER` / `SERVICE_PROFILE_READER`.
2. `service_tax_profiles` ganha `operation_nature`, `withholding_policy` e `withholding_rates` (necessários para detectar mercadoria/salão-parceiro e para retenções sem presunção).
3. `CreateInvoiceDto` ganha `discount?: number` (desconto incondicional; exigido pelo cenário 07 e pelo `vDescIncond` da DPS).
4. A obrigação `pisCofins` do spec foi absorvida por `federalWithholding` (PIS/Cofins próprios não se destacam na NFS-e).
5. Permissões: reutiliza `nfse.companies.view/manage` para os endpoints de perfil fiscal (sem permissão nova).
6. `CalculateTaxesHandler` é registrado no `WorkerAppModule` (depende de `NfseWorkflowService`, que só existe no worker).

## Review Focus

- Nota de competência passada usa o perfil vigente **na competência**, não o de hoje (Task 9, 17).
- Mudança de regime no meio do mês: duas notas na mesma semana pegam perfis diferentes (Task 3, 9).
- Duas execuções simultâneas do pipeline não compartilham contexto (Task 2).
- `UNSUPPORTED` nunca é tratado como `NOT_APPLICABLE` e bloqueia a emissão (Task 11).
- Cliente PJ + política de retenção `UNKNOWN` bloqueia (não presume "sem retenção") (Task 11).
- Desconto incondicional > valor, valor com 3 casas, `amount` 0,01 e 9999999999,99 (Task 12, 15).
- Resposta do RTC com componentes que não somam é rejeitada (Task 13/14).
- Serviço de mercadoria (`GOODS`) e salão-parceiro não viram NFS-e (Task 11).
- Cliente anônimo percorre workflow, e-mail e doc-prep sem `TypeError` (Task 15).
- Snapshot nunca é alterado (trigger) e reprocessar a mesma mensagem não duplica (Task 16, 18).

---

## Task 1: Kernel e tipos de domínio fiscal

**Files (todos novos, puros):**
- `src/modules/invoice/domain/fiscal/result.ts`
- `src/modules/invoice/domain/fiscal/fiscal-error.ts`
- `src/modules/invoice/domain/fiscal/money.ts`
- `src/modules/invoice/domain/fiscal/tax-amount.ts`
- `src/modules/invoice/domain/fiscal/normalized-invoice.ts`
- `src/modules/invoice/domain/fiscal/classification/service-tax-classification.ts`
- `src/modules/invoice/domain/fiscal/applicability/tax-applicability.ts`
- `src/modules/invoice/domain/fiscal/legacy/legacy-tax-result.ts`
- `src/modules/invoice/domain/fiscal/rtc/rtc-tax-result.ts`
- `src/modules/invoice/domain/fiscal/fiscal-context.ts`
- `src/modules/invoice/domain/fiscal/fiscal-step.ts`
- `src/modules/company/domain/fiscal-profile.ts`
- `src/modules/company/domain/service-tax-profile.ts`
- Test: `result.spec.ts`, `fiscal-error.spec.ts`, `money.spec.ts` ao lado dos arquivos; `src/modules/company/domain/fiscal-profile.spec.ts`

**Interfaces — Produces (todos os nomes abaixo são usados literalmente pelas tasks seguintes):**
```ts
// result.ts
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export const ok: <T>(value: T) => Result<T, never>;
export const err: <E>(error: E) => Result<never, E>;
// money.ts
export type DecimalString = string;
export function toDecimal(value: string | number | Decimal): Decimal;
export function roundMoney(value: Decimal): Decimal;           // 2 places, HALF_UP
export function moneyString(value: Decimal): DecimalString;    // roundMoney(...).toFixed(2)
export function rateString(value: Decimal): DecimalString;     // exact, no rounding
export function percentOf(base: Decimal, ratePercent: Decimal): Decimal;
export function effectiveRate(nominalPercent: Decimal, reductionPercent: Decimal): Decimal;
```

- [ ] **Step 1: Write failing tests**

`result.spec.ts`:
```ts
import { err, ok } from './result';

describe('Result', () => {
  it('ok carries a value', () => expect(ok(1)).toEqual({ ok: true, value: 1 }));
  it('err carries an error', () => expect(err('x')).toEqual({ ok: false, error: 'x' }));
});
```

`fiscal-error.spec.ts`:
```ts
import { fiscalError } from './fiscal-error';

describe('fiscalError', () => {
  it('builds a frozen non-retryable error by default', () => {
    const e = fiscalError({ code: 'FISCAL_PROFILE_MISSING', message: 'm', category: 'CONFIGURATION' });
    expect(e).toEqual({ code: 'FISCAL_PROFILE_MISSING', message: 'm', step: '', details: {}, retryable: false, category: 'CONFIGURATION' });
    expect(Object.isFrozen(e)).toBe(true);
  });
  it('only INTEGRATION errors may be retryable', () => {
    expect(() => fiscalError({ code: 'TAX_RATE_NOT_FOUND', message: 'm', category: 'CALCULATION', retryable: true })).toThrow();
    expect(fiscalError({ code: 'TAX_CALCULATION_UNAVAILABLE', message: 'm', category: 'INTEGRATION', retryable: true }).retryable).toBe(true);
  });
  it('keeps structured details', () => {
    const e = fiscalError({ code: 'FISCAL_CLASSIFICATION_REQUIRED', message: 'm', category: 'CLASSIFICATION', details: { missingFields: ['service.fiscal.nbsCode'] } });
    expect(e.details).toEqual({ missingFields: ['service.fiscal.nbsCode'] });
  });
});
```

`money.spec.ts` (exemplos do briefing, usados só como matemática):
```ts
import { Decimal } from '@/shared/types/money';
import { effectiveRate, moneyString, percentOf, rateString, roundMoney, toDecimal } from './money';

describe('fiscal money', () => {
  it('computes the 2026 demonstration math exactly', () => {
    const base = toDecimal('1000.00');
    expect(moneyString(percentOf(base, toDecimal('0.9')))).toBe('9.00');
    expect(moneyString(percentOf(base, toDecimal('0.1')))).toBe('1.00');
  });
  it('applies a reduction to the nominal rate', () => {
    const cbs = effectiveRate(toDecimal('0.9'), toDecimal('60'));
    const ibs = effectiveRate(toDecimal('0.1'), toDecimal('60'));
    expect(rateString(cbs)).toBe('0.36');
    expect(rateString(ibs)).toBe('0.04');
    expect(moneyString(percentOf(toDecimal('1000'), cbs))).toBe('3.60');
    expect(moneyString(percentOf(toDecimal('1000'), ibs))).toBe('0.40');
  });
  it('subtracts a discount without float drift', () => {
    expect(moneyString(toDecimal('1000.00').minus('100.00'))).toBe('900.00');
    expect(moneyString(toDecimal('0.1').plus('0.2'))).toBe('0.30');
  });
  it('rounds half up at the cent only', () => {
    expect(roundMoney(new Decimal('0.005')).toFixed(2)).toBe('0.01');
    expect(roundMoney(new Decimal('1.004')).toFixed(2)).toBe('1.00');
  });
  it('rejects non-finite input', () => {
    expect(() => toDecimal('abc')).toThrow();
    expect(() => toDecimal(Number.NaN)).toThrow();
  });
});
```

`fiscal-profile.spec.ts` (company domain):
```ts
import { isEffectiveOn, regimeKindFromLegacy, legacyFromRegimeKind } from './fiscal-profile';

describe('fiscal profile dates', () => {
  const p = { validFrom: '2026-03-01', validUntil: '2026-09-01' };
  it.each([['2026-02-28', false], ['2026-03-01', true], ['2026-08-31', true], ['2026-09-01', false]])(
    '%s -> %s', (d, expected) => expect(isEffectiveOn(p, d)).toBe(expected));
  it('open-ended profile stays effective', () => expect(isEffectiveOn({ validFrom: '2026-03-01', validUntil: null }, '2099-01-01')).toBe(true));
});

describe('legacy regime mapping', () => {
  it('round trips the four legacy values', () => {
    for (const legacy of ['MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real'] as const)
      expect(legacyFromRegimeKind(regimeKindFromLegacy(legacy))).toBe(legacy);
  });
  it('has no legacy label for UNKNOWN', () => expect(legacyFromRegimeKind('UNKNOWN')).toBeNull());
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn jest src/modules/invoice/domain/fiscal src/modules/company/domain/fiscal-profile.spec.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implement kernel**

`result.ts`:
```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

`fiscal-error.ts`:
```ts
export const FISCAL_ERROR_CODES = [
  'FISCAL_PROFILE_MISSING',
  'FISCAL_PROFILE_NOT_EFFECTIVE',
  'FISCAL_CLASSIFICATION_REQUIRED',
  'FISCAL_CLASSIFICATION_INVALID',
  'FISCAL_CLASSIFICATION_AMBIGUOUS',
  'TAX_APPLICABILITY_UNKNOWN',
  'TAX_REGIME_UNSUPPORTED',
  'TAX_RATE_NOT_FOUND',
  'TAX_CALCULATION_UNAVAILABLE',
  'TAX_CALCULATION_UNSUPPORTED',
  'TAX_RULE_NOT_EFFECTIVE',
  'FISCAL_VALIDATION_FAILED',
  'FISCAL_REVIEW_REQUIRED',
  'OPERATION_DOCUMENT_UNSUPPORTED',
  'FISCAL_INTERNAL_ERROR',
] as const;
export type FiscalErrorCode = (typeof FISCAL_ERROR_CODES)[number];

export type FiscalErrorCategory =
  | 'VALIDATION' | 'CONFIGURATION' | 'CLASSIFICATION' | 'CALCULATION'
  | 'INTEGRATION' | 'UNSUPPORTED' | 'INTERNAL';

export interface FiscalError {
  readonly code: FiscalErrorCode;
  readonly message: string;
  readonly step: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;
  readonly category: FiscalErrorCategory;
}

export function fiscalError(input: {
  code: FiscalErrorCode;
  message: string;
  category: FiscalErrorCategory;
  step?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}): FiscalError {
  const retryable = input.retryable ?? false;
  if (retryable && input.category !== 'INTEGRATION')
    throw new Error('Only INTEGRATION fiscal errors can be retryable');
  return Object.freeze({
    code: input.code,
    message: input.message,
    step: input.step ?? '',
    details: Object.freeze({ ...(input.details ?? {}) }),
    retryable,
    category: input.category,
  });
}
```

`money.ts`:
```ts
import { Decimal } from '@/shared/types/money';

export type DecimalString = string;

export function toDecimal(value: string | number | Decimal): Decimal {
  const d = new Decimal(value);
  if (!d.isFinite()) throw new Error('Decimal value must be finite');
  return d;
}

export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export const moneyString = (value: Decimal): DecimalString => roundMoney(value).toFixed(2);
export const rateString = (value: Decimal): DecimalString => value.toFixed();
export const percentOf = (base: Decimal, ratePercent: Decimal): Decimal =>
  base.mul(ratePercent).div(100);
export const effectiveRate = (nominalPercent: Decimal, reductionPercent: Decimal): Decimal =>
  nominalPercent.mul(new Decimal(1).minus(reductionPercent.div(100)));
```
(`new Decimal('abc')` e `new Decimal(NaN)` lançam `DecimalError` ou resultam em NaN — o `isFinite` cobre `NaN`/`Infinity`; se `new Decimal('abc')` lançar, o teste já passa.)

`tax-amount.ts`:
```ts
import type { DecimalString } from './money';

export interface TaxAmount {
  readonly base: DecimalString;
  readonly rate?: DecimalString;
  readonly effectiveRate?: DecimalString;
  readonly reductionRate?: DecimalString;
  readonly amount: DecimalString;
}
```

`company/domain/fiscal-profile.ts`:
```ts
import type { TaxRegime } from './company';

export const TAX_REGIME_KINDS = [
  'MEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'OUTRO_REGIME', 'UNKNOWN',
] as const;
export type TaxRegimeKind = (typeof TAX_REGIME_KINDS)[number];
export type ProfileReviewStatus = 'unreviewed' | 'approved' | 'rejected';

export interface CompanyFiscalProfile {
  id: string;
  tenantId: string;
  companyId: string;
  taxRegime: TaxRegimeKind;
  simpleNational: boolean;
  specialTaxRegime: string | null;
  ibsCbsRegularOption: boolean;
  ibsCbsRegularFrom: string | null;   // YYYY-MM-DD
  validFrom: string;                  // YYYY-MM-DD, inclusive
  validUntil: string | null;          // exclusive; null = open
  source: string;
  reviewStatus: ProfileReviewStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export function isEffectiveOn(
  profile: Pick<CompanyFiscalProfile, 'validFrom' | 'validUntil'>,
  date: string,
): boolean {
  return profile.validFrom <= date && (profile.validUntil === null || date < profile.validUntil);
}

const LEGACY_TO_KIND: Record<TaxRegime, TaxRegimeKind> = {
  MEI: 'MEI',
  'Simples Nacional': 'SIMPLES_NACIONAL',
  'Lucro Presumido': 'LUCRO_PRESUMIDO',
  'Lucro Real': 'LUCRO_REAL',
};
export const regimeKindFromLegacy = (legacy: TaxRegime): TaxRegimeKind => LEGACY_TO_KIND[legacy];
export function legacyFromRegimeKind(kind: TaxRegimeKind): TaxRegime | null {
  const entry = Object.entries(LEGACY_TO_KIND).find(([, value]) => value === kind);
  return entry ? (entry[0] as TaxRegime) : null;
}
```
(`TaxRegime` é exportado por `company.ts`; após a Task 4 continuará exportado.)

`company/domain/service-tax-profile.ts`:
```ts
import type { ProfileReviewStatus, TaxRegimeKind } from './fiscal-profile';

export type OperationNature = 'SERVICE' | 'GOODS' | 'MIXED' | 'PARTNER_SALON';
export type IssTaxation = 'NORMAL' | 'FIXED' | 'EXEMPT';
export type WithholdingPolicy = 'UNKNOWN' | 'NONE_CONFIRMED' | 'CONFIGURED';
/** Percent strings, e.g. "1.5". */
export interface WithholdingRates { irrf?: string; pis?: string; cofins?: string; csll?: string; inss?: string }

export interface CompanyServiceTaxProfile {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  serviceCode: string;
  municipalServiceCode: string | null;
  nbsCode: string | null;
  cst: string | null;
  classCode: string | null;
  operationIndicator: string | null;
  operationNature: OperationNature;
  regimeApplicability: TaxRegimeKind[];
  incidenceMunicipalityCode: string | null;
  issTaxation: IssTaxation | null;
  issRate: string | null;
  issWithholdingDefault: boolean;
  withholdingPolicy: WithholdingPolicy;
  withholdingRates: WithholdingRates;
  effectiveFrom: string;
  effectiveUntil: string | null;
  classificationSource: string;
  reviewStatus: ProfileReviewStatus;
  catalogVersion: string | null;
  createdAt: Date;
}
```

`normalized-invoice.ts`:
```ts
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { DecimalString } from './money';

export interface ServiceFiscalInput {
  nbsCode?: string; cst?: string; classCode?: string; operationIndicator?: string;
}
export interface FiscalCustomer {
  kind: 'CPF' | 'CNPJ';
  taxId: string;
  municipalityCode: string | null;
}
export interface NormalizedInvoice {
  invoiceId: string;
  tenantId: string;
  environment: ExecutionEnvironment;
  company: { id: string; taxId: string; municipalityCode: string; municipalRegistration: string | null };
  /** Fato gerador, YYYY-MM-DD. */
  competenceDate: string;
  grossAmount: DecimalString;
  discountAmount: DecimalString;
  service: {
    code: string;
    municipalityCode: string;
    description: string | null;
    fiscal: ServiceFiscalInput | null;
    serviceProfileId: string | null;
  };
  customer: FiscalCustomer | null;
}
```

`classification/service-tax-classification.ts`:
```ts
import type { IssTaxation, OperationNature, WithholdingPolicy, WithholdingRates } from '@/modules/company/domain/service-tax-profile';
import type { DecimalString } from '../money';

export type ClassificationSource = 'request_override' | 'company_service_profile' | 'official_catalog';

export interface ServiceTaxClassification {
  serviceCode: string;
  municipalServiceCode: string | null;
  nbsCode: string | null;
  cst: string | null;
  classCode: string | null;
  operationIndicator: string | null;
  source: ClassificationSource;
  serviceProfileId: string | null;
  operationNature: OperationNature;
  iss: {
    taxation: IssTaxation | null;
    rate: DecimalString | null;
    withholdingDefault: boolean;
    incidenceMunicipalityCode: string | null;
  };
  withholding: { policy: WithholdingPolicy; rates: WithholdingRates };
  catalogVersions: Record<string, string>;
  catalogValidated: boolean;
  justification: string;
}
```

`applicability/tax-applicability.ts`:
```ts
export type Obligation =
  | { readonly status: 'REQUIRED' }
  | { readonly status: 'NOT_APPLICABLE'; readonly reason: string }
  | { readonly status: 'UNSUPPORTED'; readonly reason: string }
  | { readonly status: 'MISSING_CONFIGURATION'; readonly reason: string; readonly missingFields: readonly string[] };

export interface TaxApplicability {
  readonly strategy: string;
  readonly customerRequired: boolean;
  readonly iss: Obligation;
  readonly issWithheld: Obligation;
  readonly federalWithholding: Obligation;
  readonly cbs: Obligation;
  readonly ibs: Obligation;
  readonly specialTreatment: Obligation;
  readonly collectionWaived: boolean;
  readonly rulesVersion: string;
  readonly legalReferences: readonly string[];
}
```

`legacy/legacy-tax-result.ts`:
```ts
import type { DecimalString } from '../money';
import type { TaxAmount } from '../tax-amount';

export interface WithholdingAmount {
  readonly tax: 'ISS' | 'IRRF' | 'PIS' | 'COFINS' | 'CSLL' | 'INSS';
  readonly base: DecimalString;
  readonly rate: DecimalString;
  readonly amount: DecimalString;
}
export interface LegacyTaxResult {
  readonly iss: TaxAmount | null;
  readonly issWithheld: boolean;
  readonly issResponsible: 'PROVIDER' | 'CUSTOMER' | null;
  readonly withholdings: readonly WithholdingAmount[];
  readonly netReceivableAmount: DecimalString;
}
```

`rtc/rtc-tax-result.ts`:
```ts
import type { TaxAmount } from '../tax-amount';

export interface RtcTaxResult {
  readonly calculatorVersion: string;
  readonly cbs: TaxAmount | null;
  readonly ibsState: TaxAmount | null;
  readonly ibsCity: TaxAmount | null;
  readonly ibsTotal: TaxAmount | null;
  readonly legalReferences: readonly string[];
  readonly calculationMemory: readonly unknown[];
  readonly collectionWaived: boolean;
}
```

`fiscal-step.ts` + `fiscal-context.ts`:
```ts
// fiscal-step.ts
import type { FiscalError } from './fiscal-error';
import type { FiscalContext } from './fiscal-context';
import type { Result } from './result';

export type StepOutcome =
  | { readonly status: 'applied'; readonly context: FiscalContext }
  | { readonly status: 'skipped'; readonly context: FiscalContext; readonly reason: string };

export interface FiscalStep {
  readonly name: string;
  /** Required steps may not return 'skipped'. */
  readonly required: boolean;
  execute(context: Readonly<FiscalContext>): Promise<Result<StepOutcome, FiscalError>>;
}
```
```ts
// fiscal-context.ts
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { NormalizedInvoice } from './normalized-invoice';
import type { ServiceTaxClassification } from './classification/service-tax-classification';
import type { TaxApplicability } from './applicability/tax-applicability';
import type { LegacyTaxResult } from './legacy/legacy-tax-result';
import type { RtcTaxResult } from './rtc/rtc-tax-result';

export interface FiscalWarning { readonly code: string; readonly message: string; readonly step: string }
export interface StepTrace {
  readonly step: string;
  readonly status: 'applied' | 'skipped' | 'failed';
  readonly durationMs: number;
  readonly reason?: string;
  readonly errorCode?: string;
}

export interface FiscalContext {
  readonly invoice: NormalizedInvoice;
  readonly companyProfile?: CompanyFiscalProfile;
  readonly classification?: ServiceTaxClassification;
  readonly applicability?: TaxApplicability;
  readonly legacyTaxes?: LegacyTaxResult;
  readonly rtcTaxes?: RtcTaxResult;
  readonly warnings: readonly FiscalWarning[];
  readonly trace: readonly StepTrace[];
}

export const initialFiscalContext = (invoice: NormalizedInvoice): FiscalContext => ({
  invoice,
  warnings: [],
  trace: [],
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn jest src/modules/invoice/domain/fiscal src/modules/company/domain/fiscal-profile.spec.ts && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/invoice/domain/fiscal src/modules/company/domain
git commit -m "feat(fiscal): add result, fiscal error, money and context kernel"
```

---

## Task 2: FiscalPipeline (executor, trace e métricas)

**Files:**
- Create: `src/modules/invoice/domain/fiscal/fiscal-pipeline.ts`
- Create: `src/modules/invoice/application/fiscal/pipeline-observer.ts` (métricas OTel + log)
- Test: `src/modules/invoice/domain/fiscal/fiscal-pipeline.spec.ts`

**Interfaces:**
- Consumes: `FiscalStep`, `StepOutcome`, `FiscalContext`, `initialFiscalContext`, `Result`, `ok`, `err`, `fiscalError` (Task 1).
- Produces:
  ```ts
  export interface PipelineObserver {
    stepFinished(step: string, status: 'applied' | 'skipped' | 'failed', durationMs: number, errorCode?: string): void;
    pipelineFinished(ok: boolean, durationMs: number, errorCode?: string): void;
  }
  export class FiscalPipeline {
    constructor(steps: readonly FiscalStep[], observer?: PipelineObserver);
    execute(initial: FiscalContext): Promise<Result<FiscalContext, FiscalError>>;
  }
  ```

- [ ] **Step 1: Write the failing tests** — `fiscal-pipeline.spec.ts`

```ts
import { fiscalError } from './fiscal-error';
import { FiscalPipeline } from './fiscal-pipeline';
import type { FiscalContext } from './fiscal-context';
import { initialFiscalContext } from './fiscal-context';
import type { FiscalStep } from './fiscal-step';
import type { NormalizedInvoice } from './normalized-invoice';
import { err, ok } from './result';

const invoice = (id: string): NormalizedInvoice => ({
  invoiceId: id, tenantId: 't', environment: 'test',
  company: { id: 'c', taxId: '11222333000181', municipalityCode: '3550308', municipalRegistration: null },
  competenceDate: '2026-10-13', grossAmount: '50.00', discountAmount: '0.00',
  service: { code: '060101', municipalityCode: '3550308', description: null, fiscal: null, serviceProfileId: null },
  customer: null,
});

const applied = (name: string, calls: string[], extra: Partial<FiscalContext> = {}, delayMs = 0): FiscalStep => ({
  name, required: true,
  async execute(ctx) {
    calls.push(name);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return ok({ status: 'applied', context: { ...ctx, ...extra } });
  },
});

describe('FiscalPipeline', () => {
  it('runs steps in declared order and records a trace entry per step', async () => {
    const calls: string[] = [];
    const result = await new FiscalPipeline([applied('A', calls), applied('B', calls), applied('C', calls)]).execute(initialFiscalContext(invoice('i1')));
    expect(calls).toEqual(['A', 'B', 'C']);
    expect(result.ok && result.value.trace.map((t) => [t.step, t.status])).toEqual([['A', 'applied'], ['B', 'applied'], ['C', 'applied']]);
  });

  it('stops at the first failure, never runs later steps and stamps the step name', async () => {
    const calls: string[] = [];
    const failing: FiscalStep = { name: 'B', required: true, async execute() {
      calls.push('B');
      return err(fiscalError({ code: 'FISCAL_CLASSIFICATION_REQUIRED', message: 'm', category: 'CLASSIFICATION', details: { missingFields: ['service.fiscal.nbsCode'] } }));
    } };
    const result = await new FiscalPipeline([applied('A', calls), failing, applied('C', calls)]).execute(initialFiscalContext(invoice('i1')));
    expect(calls).toEqual(['A', 'B']);
    expect(result).toMatchObject({ ok: false, error: { code: 'FISCAL_CLASSIFICATION_REQUIRED', step: 'B', category: 'CLASSIFICATION', retryable: false, details: { missingFields: ['service.fiscal.nbsCode'] } } });
  });

  it('propagates the context produced by earlier steps', async () => {
    const seen: unknown[] = [];
    const reader: FiscalStep = { name: 'R', required: true, async execute(ctx) { seen.push(ctx.warnings); return ok({ status: 'applied', context: ctx }); } };
    const writer = applied('W', [], { warnings: [{ code: 'X', message: 'm', step: 'W' }] });
    await new FiscalPipeline([writer, reader]).execute(initialFiscalContext(invoice('i1')));
    expect(seen).toEqual([[{ code: 'X', message: 'm', step: 'W' }]]);
  });

  it('records skipped optional steps with the reason and continues', async () => {
    const calls: string[] = [];
    const optional: FiscalStep = { name: 'O', required: false, async execute(ctx) { calls.push('O'); return ok({ status: 'skipped', context: ctx, reason: 'not applicable' }); } };
    const result = await new FiscalPipeline([optional, applied('B', calls)]).execute(initialFiscalContext(invoice('i1')));
    expect(calls).toEqual(['O', 'B']);
    expect(result.ok && result.value.trace[0]).toMatchObject({ step: 'O', status: 'skipped', reason: 'not applicable' });
  });

  it('rejects a required step that returns skipped', async () => {
    const sneaky: FiscalStep = { name: 'S', required: true, async execute(ctx) { return ok({ status: 'skipped', context: ctx, reason: 'nope' }); } };
    const result = await new FiscalPipeline([sneaky]).execute(initialFiscalContext(invoice('i1')));
    expect(result).toMatchObject({ ok: false, error: { code: 'FISCAL_INTERNAL_ERROR', category: 'INTERNAL', step: 'S' } });
  });

  it('does not mutate the initial context', async () => {
    const initial = initialFiscalContext(invoice('i1'));
    const frozen = JSON.stringify(initial);
    await new FiscalPipeline([applied('A', [], { warnings: [{ code: 'X', message: 'm', step: 'A' }] })]).execute(initial);
    expect(JSON.stringify(initial)).toBe(frozen);
  });

  it('keeps concurrent executions isolated', async () => {
    const pipeline = new FiscalPipeline([applied('A', [], {}, 15), applied('B', [], {}, 5)]);
    const [a, b] = await Promise.all([
      pipeline.execute(initialFiscalContext(invoice('inv-a'))),
      pipeline.execute(initialFiscalContext(invoice('inv-b'))),
    ]);
    expect(a.ok && a.value.invoice.invoiceId).toBe('inv-a');
    expect(b.ok && b.value.invoice.invoiceId).toBe('inv-b');
    expect(a.ok && a.value.trace).toHaveLength(2);
  });

  it('lets unexpected exceptions propagate (bugs/infra are retried by the outbox)', async () => {
    const boom: FiscalStep = { name: 'X', required: true, async execute() { throw new Error('db down'); } };
    await expect(new FiscalPipeline([boom]).execute(initialFiscalContext(invoice('i1')))).rejects.toThrow('db down');
  });

  it('rejects duplicate step names at construction', () => {
    expect(() => new FiscalPipeline([applied('A', []), applied('A', [])])).toThrow('Duplicate fiscal step name: A');
  });

  it('reports every step and the pipeline outcome to the observer', async () => {
    const observer = { stepFinished: jest.fn(), pipelineFinished: jest.fn() };
    await new FiscalPipeline([applied('A', [])], observer).execute(initialFiscalContext(invoice('i1')));
    expect(observer.stepFinished).toHaveBeenCalledWith('A', 'applied', expect.any(Number), undefined);
    expect(observer.pipelineFinished).toHaveBeenCalledWith(true, expect.any(Number), undefined);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn jest src/modules/invoice/domain/fiscal/fiscal-pipeline.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — `fiscal-pipeline.ts`

```ts
import { fiscalError, type FiscalError } from './fiscal-error';
import type { FiscalContext, StepTrace } from './fiscal-context';
import type { FiscalStep } from './fiscal-step';
import { err, ok, type Result } from './result';

export interface PipelineObserver {
  stepFinished(step: string, status: StepTrace['status'], durationMs: number, errorCode?: string): void;
  pipelineFinished(ok: boolean, durationMs: number, errorCode?: string): void;
}

const NOOP_OBSERVER: PipelineObserver = { stepFinished() {}, pipelineFinished() {} };

export class FiscalPipeline {
  constructor(
    private readonly steps: readonly FiscalStep[],
    private readonly observer: PipelineObserver = NOOP_OBSERVER,
  ) {
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.name)) throw new Error(`Duplicate fiscal step name: ${step.name}`);
      seen.add(step.name);
    }
  }

  async execute(initial: FiscalContext): Promise<Result<FiscalContext, FiscalError>> {
    const startedAt = performance.now();
    let context = initial;
    for (const step of this.steps) {
      const stepStartedAt = performance.now();
      const outcome = await step.execute(context);
      const durationMs = performance.now() - stepStartedAt;

      if (!outcome.ok) {
        const error: FiscalError = { ...outcome.error, step: step.name };
        this.observer.stepFinished(step.name, 'failed', durationMs, error.code);
        this.observer.pipelineFinished(false, performance.now() - startedAt, error.code);
        return err(error);
      }
      if (outcome.value.status === 'skipped' && step.required) {
        const error = fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: `Required fiscal step ${step.name} cannot be skipped`,
          category: 'INTERNAL',
          step: step.name,
          details: { reason: outcome.value.reason },
        });
        this.observer.stepFinished(step.name, 'failed', durationMs, error.code);
        this.observer.pipelineFinished(false, performance.now() - startedAt, error.code);
        return err(error);
      }
      const trace: StepTrace = {
        step: step.name,
        status: outcome.value.status,
        durationMs,
        ...(outcome.value.status === 'skipped' ? { reason: outcome.value.reason } : {}),
      };
      this.observer.stepFinished(step.name, trace.status, durationMs, undefined);
      context = { ...outcome.value.context, trace: [...outcome.value.context.trace, trace] };
    }
    this.observer.pipelineFinished(true, performance.now() - startedAt, undefined);
    return ok(context);
  }
}
```

`pipeline-observer.ts` (aplicação; métricas OTel como `outbox.metrics.ts`):
```ts
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { PipelineObserver } from '../../domain/fiscal/fiscal-pipeline';

const meter = metrics.getMeter('greenflow.fiscal');
const pipelineDuration = meter.createHistogram('fiscal_pipeline_duration', { unit: 's' });
const stepDuration = meter.createHistogram('fiscal_step_duration', { unit: 's' });
const stepFailed = meter.createCounter('fiscal_step_failed_total');
const stepSkipped = meter.createCounter('fiscal_step_skipped_total');

export class OtelPipelineObserver implements PipelineObserver {
  private readonly logger = new Logger('FiscalPipeline');
  constructor(private readonly context: { invoiceId: string; companyId: string; correlationId?: string }) {}

  stepFinished(step: string, status: 'applied' | 'skipped' | 'failed', durationMs: number, errorCode?: string): void {
    stepDuration.record(durationMs / 1000, { step, status });
    if (status === 'failed') stepFailed.add(1, { step, code: errorCode ?? 'unknown' });
    if (status === 'skipped') stepSkipped.add(1, { step });
    this.logger.log({ ...this.context, step, status, errorCode, durationMs: Math.round(durationMs) }, 'fiscal step finished');
  }

  pipelineFinished(ok: boolean, durationMs: number, errorCode?: string): void {
    pipelineDuration.record(durationMs / 1000, { ok: String(ok) });
    this.logger.log({ ...this.context, ok, errorCode, durationMs: Math.round(durationMs) }, 'fiscal pipeline finished');
  }
}
```
Sem teste de unidade dedicado (adapter de log/métrica); coberto pela execução do handler (Task 18).

- [ ] **Step 4: Run to verify they pass**

Run: `yarn jest src/modules/invoice/domain/fiscal && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/invoice
git commit -m "feat(fiscal): add fail-fast fiscal pipeline with trace and observer"
```

---

## Task 3: Perfil fiscal da empresa (persistência histórica append-only)

**Files:**
- Modify: `src/infra/database/rls-tables.ts` (+ `'company_fiscal_profiles'`)
- Modify: `src/infra/database/tenant-rls.postgres.integration.spec.ts` (contagem 17 → 18)
- Create: `src/infra/database/migrations/1791780000000-CreateCompanyFiscalProfiles.ts`
- Create: `src/modules/company/domain/fiscal-profile.repository.ts`
- Create: `src/modules/company/infra/company-fiscal-profile.orm-entity.ts`
- Create: `src/modules/company/infra/typeorm-company-fiscal-profile.repository.ts`
- Create: `src/modules/company/application/company-fiscal-profile.service.ts`
- Modify: `src/modules/company/company.module.ts`
- Test: `src/modules/company/application/company-fiscal-profile.service.spec.ts` (unit com repositório fake) e `src/modules/company/infra/typeorm-company-fiscal-profile.repository.postgres.integration.spec.ts`

**Interfaces:**
- Consumes: `CompanyFiscalProfile`, `TaxRegimeKind`, `isEffectiveOn` (Task 1).
- Produces:
  ```ts
  export interface NewFiscalProfile {
    taxRegime: TaxRegimeKind; simpleNational: boolean; specialTaxRegime: string | null;
    ibsCbsRegularOption: boolean; ibsCbsRegularFrom: string | null;
    validFrom: string; source: string; reviewStatus: ProfileReviewStatus; reviewedBy: string | null;
  }
  export abstract class IFiscalProfileRepository {
    findEffective(companyId: string, tenantId: string, date: string): Promise<CompanyFiscalProfile | null>;
    findOpen(companyId: string, tenantId: string): Promise<CompanyFiscalProfile | null>;
    list(companyId: string, tenantId: string): Promise<CompanyFiscalProfile[]>;   // validFrom DESC
    append(companyId: string, tenantId: string, input: NewFiscalProfile): Promise<CompanyFiscalProfile>;
  }
  export class CompanyFiscalProfileService {
    record(companyId: string, tenantId: string, input: NewFiscalProfile): Promise<CompanyFiscalProfile>;
    approve(companyId: string, tenantId: string, profileId: string, reviewedBy: string): Promise<CompanyFiscalProfile>;
    list(companyId: string, tenantId: string): Promise<CompanyFiscalProfile[]>;
    current(companyId: string, tenantId: string): Promise<CompanyFiscalProfile | null>;
  }
  ```
  Regras do `append` (dentro de uma transação, com `SELECT … FOR UPDATE` na linha da empresa): sem perfil aberto → insere; `validFrom` > aberto → fecha o aberto em `validFrom` e insere; `validFrom` == aberto e aberto **não aprovado** → atualiza no lugar; `validFrom` == aberto e aprovado → `ConflictException('profile_validity_conflict')`; `validFrom` < aberto → `FiscalValidationError` (`validFrom`, código `invalid`, "cannot start before the current profile").

- [ ] **Step 1: Migration** — `1791780000000-CreateCompanyFiscalProfiles.ts` (criação + cópia dos dados atuais; **não** remove ainda as colunas da company — isso é a Task 4)

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCompanyFiscalProfiles1791780000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape('schema' in options ? (options.schema ?? 'corvo') : 'corvo');
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.company_fiscal_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      tax_regime varchar(20) NOT NULL,
      simple_national boolean NOT NULL DEFAULT false,
      special_tax_regime varchar(50),
      ibs_cbs_regular_option boolean NOT NULL DEFAULT false,
      ibs_cbs_regular_from date,
      valid_from date NOT NULL,
      valid_until date,
      source varchar(30) NOT NULL,
      review_status varchar(12) NOT NULL DEFAULT 'unreviewed',
      reviewed_by varchar(100),
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_cfp_regime CHECK (tax_regime IN ('MEI','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','OUTRO_REGIME','UNKNOWN')),
      CONSTRAINT ck_cfp_review CHECK (review_status IN ('unreviewed','approved','rejected')),
      CONSTRAINT ck_cfp_validity CHECK (valid_until IS NULL OR valid_until > valid_from)
    )`);
    await runner.query(`CREATE UNIQUE INDEX uq_cfp_company_valid_from ON ${s}.company_fiscal_profiles (company_id, valid_from)`);
    await runner.query(`CREATE UNIQUE INDEX uq_cfp_company_open ON ${s}.company_fiscal_profiles (company_id) WHERE valid_until IS NULL`);
    await runner.query(`CREATE INDEX idx_cfp_company_validity ON ${s}.company_fiscal_profiles (company_id, valid_from, valid_until)`);
    await runner.query(`CREATE INDEX idx_cfp_tenant ON ${s}.company_fiscal_profiles (tenant_id)`);

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner = "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(`ALTER TABLE ${s}.company_fiscal_profiles ENABLE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE ${s}.company_fiscal_profiles FORCE ROW LEVEL SECURITY`);
    await runner.query(`CREATE POLICY tenant_isolation_policy ON ${s}.company_fiscal_profiles USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`);

    // One initial profile per existing company, effective since the company was created.
    await runner.query(`INSERT INTO ${s}.company_fiscal_profiles
      (tenant_id, company_id, tax_regime, simple_national, special_tax_regime, valid_from, source, review_status)
      SELECT tenant_id, id,
        CASE tax_regime WHEN 'MEI' THEN 'MEI' WHEN 'Simples Nacional' THEN 'SIMPLES_NACIONAL'
          WHEN 'Lucro Presumido' THEN 'LUCRO_PRESUMIDO' WHEN 'Lucro Real' THEN 'LUCRO_REAL' ELSE 'UNKNOWN' END,
        simple_national, NULLIF(special_regime, ''), created_at::date, 'company_legacy', 'unreviewed'
      FROM ${s}.nfse_companies`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE ${this.schema(runner)}.company_fiscal_profiles`);
  }
}
```
Atualize `TENANT_RLS_TABLES` (`[...BASELINE_RLS_TABLES, 'outbox_messages', 'company_fiscal_profiles']`) e o teste de RLS (18).

- [ ] **Step 2: Write failing unit tests for the service** — `company-fiscal-profile.service.spec.ts` com um `FakeFiscalProfileRepository` em memória que implementa `IFiscalProfileRepository` com as mesmas regras do `append` (a regra vive no **repositório**, então o unit do service testa só delegação e `approve`; as regras de vigência ficam no teste de integração). Casos do service:

```ts
it('record delegates to the repository append', async () => { /* repo.append called with (companyId, tenantId, input) and its result returned */ });
it('approve marks the profile approved and stamps reviewer', async () => {
  // repo.findById returns an unreviewed profile; service.approve → repo.markApproved(profileId, tenantId, reviewedBy, now)
});
it('approve of an unknown profile throws NotFoundException', async () => { /* repo.findById → null */ });
```
Adicione `findById(id, tenantId)` e `markApproved(id, tenantId, reviewedBy, at)` ao `IFiscalProfileRepository` (e à lista de Interfaces acima).

- [ ] **Step 3: Write failing integration tests** (harness da Task 2 do plano 1; `repo = new TypeOrmCompanyFiscalProfileRepository(runtime, new TypeOrmTransactionContext())`):

```ts
it('creates the first profile', ...);                       // append → open profile, validUntil null
it('closes the open profile when a later one starts', ...); // append(2026-01-01) then append(2026-06-01) → first validUntil '2026-06-01'
it('findEffective picks the profile valid on the date', ...); // 2026-05-31 → first; 2026-06-01 → second
it('findEffective returns null before the first profile', ...);
it('updates in place when the same day is rewritten and the profile is not approved', ...);
it('refuses to rewrite an approved profile on the same day', ...); // rejects ConflictException profile_validity_conflict
it('refuses a profile starting before the current one', ...);     // FiscalValidationError validFrom
it('only one open profile per company (unique index)', ...);      // two concurrent appends on same company: one serializes after the other
it('RLS hides profiles from another tenant', ...);
```

- [ ] **Step 4: Run to verify they fail**

Run: `yarn jest src/modules/company/application/company-fiscal-profile.service.spec.ts` (e a integração com `MIGRATION_TEST_DATABASE_URL`)
Expected: FAIL.

- [ ] **Step 5: Implement**

`fiscal-profile.repository.ts`: `NewFiscalProfile` + `abstract class IFiscalProfileRepository` conforme Interfaces (com `findById`, `markApproved`).

`company-fiscal-profile.orm-entity.ts` com colunas `@Column({ name: …, type: … })` espelhando a migration (`validFrom: string` com `type: 'date'`, `validUntil: string | null`, `ibsCbsRegularFrom: string | null`, `reviewedAt: Date | null`, `createdAt: Date` com `@CreateDateColumn`).

`typeorm-company-fiscal-profile.repository.ts` — `append`:

```ts
async append(companyId: string, tenantId: string, input: NewFiscalProfile): Promise<CompanyFiscalProfile> {
  return runWithTenant(tenantId, () =>
    this.dataSource.transaction(async (manager) => {
      const table = this.dataSource.getMetadata(CompanyFiscalProfileOrmEntity).tablePath;
      const companies = this.dataSource.getMetadata(CompanyOrmEntity).tablePath;
      const locked = await manager.query(`SELECT id FROM ${companies} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [companyId, tenantId]);
      if (locked.length === 0) throw new NotFoundException('Company not found');
      const [open] = await manager.query(`SELECT * FROM ${table} WHERE company_id = $1 AND valid_until IS NULL`, [companyId]);
      if (open) {
        const openFrom = toDateString(open.valid_from);
        if (input.validFrom < openFrom)
          throw new FiscalValidationError([{ field: 'validFrom', code: 'invalid', message: 'validFrom cannot be before the current fiscal profile start' }]);
        if (input.validFrom === openFrom) {
          if (open.review_status === 'approved') throw new ConflictException('profile_validity_conflict');
          await manager.query(`UPDATE ${table} SET tax_regime=$2, simple_national=$3, special_tax_regime=$4, ibs_cbs_regular_option=$5, ibs_cbs_regular_from=$6, source=$7, review_status=$8, reviewed_by=$9, reviewed_at=$10 WHERE id=$1`,
            [open.id, input.taxRegime, input.simpleNational, input.specialTaxRegime, input.ibsCbsRegularOption, input.ibsCbsRegularFrom, input.source, input.reviewStatus, input.reviewedBy, input.reviewStatus === 'approved' ? new Date() : null]);
          return this.requireById(manager, open.id, tenantId);
        }
        await manager.query(`UPDATE ${table} SET valid_until = $2 WHERE id = $1`, [open.id, input.validFrom]);
      }
      const [row] = await manager.query(`INSERT INTO ${table} (tenant_id, company_id, tax_regime, simple_national, special_tax_regime, ibs_cbs_regular_option, ibs_cbs_regular_from, valid_from, source, review_status, reviewed_by, reviewed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [tenantId, companyId, input.taxRegime, input.simpleNational, input.specialTaxRegime, input.ibsCbsRegularOption, input.ibsCbsRegularFrom, input.validFrom, input.source, input.reviewStatus, input.reviewedBy, input.reviewStatus === 'approved' ? new Date() : null]);
      return this.toDomain(row);
    }),
  );
}
```
Os demais métodos (`findEffective`: `WHERE company_id=$1 AND tenant_id=$2 AND valid_from <= $3 AND (valid_until IS NULL OR $3 < valid_until)`; `findOpen`; `list ORDER BY valid_from DESC`; `findById`; `markApproved`) usam `this.manager()` como no repositório da outbox. `toDomain` converte `date` do pg (que pode vir como `Date` ou `string`) para `YYYY-MM-DD` via helper `toDateString(value: Date | string): string` (`typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)`; se o driver devolver `Date` em fuso local, configure `date` como string no entity com `transformer`). **Confira com o teste de integração que `'2026-06-01'` volta idêntico** (fuso America/Sao_Paulo é a armadilha; veja o comentário em `invoice.mapper.ts` sobre `DATE`).

`CompanyFiscalProfileService`: delega ao repositório; `approve` chama `findById` (404 se não existir) e `markApproved`.

`company.module.ts`: `TypeOrmModule.forFeature([CompanyOrmEntity, CompanyFiscalProfileOrmEntity])`, providers `{ provide: IFiscalProfileRepository, useClass: TypeOrmCompanyFiscalProfileRepository }` e `CompanyFiscalProfileService`; exports ambos.

- [ ] **Step 6: Run to verify they pass**

Run: `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/company src/infra/database && yarn typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat(company): add historical company fiscal profiles"
```

---

## Task 4: Regime tributário sai da `nfse_companies` (fonte única = perfil)

**Files:**
- Create: `src/infra/database/migrations/1791781000000-DropCompanyRegimeColumns.ts`
- Modify: `src/modules/company/domain/company.ts`, `company-domain.service.ts`
- Modify: `src/modules/company/infra/company.orm-entity.ts`, `company.mapper.ts`, `typeorm-company.repository.ts`
- Modify: `src/modules/company/application/company.service.ts`
- Modify: `src/modules/company/http/company.controller.ts`, `company.dto.ts`
- Modify: `src/modules/invoice/application/nfse-workflow.service.ts` (uso de `company.taxRegime`/`specialRegime`)
- Modify (testes/fixtures que citam as colunas): `src/infra/database/tenant-rls.postgres.integration.spec.ts`, `src/infra/database/migrations/baseline.postgres.integration.spec.ts`, `src/modules/company/**/*.spec.ts`, `src/modules/certificate/application/certificate.service.spec.ts`, `src/modules/invoice/application/invoice.service.defaults.spec.ts`, `test/*.e2e-spec.ts`
- Test: `src/modules/company/application/company.service.spec.ts` (+ novos casos)

**Interfaces:**
- Consumes: `CompanyFiscalProfileService.record/current`, `regimeKindFromLegacy`, `legacyFromRegimeKind` (Tasks 1, 3).
- Produces:
  ```ts
  // company.ts
  export interface CompanyRegimeInput { taxRegime: TaxRegime; simpleNational?: boolean; specialRegime?: string }
  // CreateCompanyInput / UpdateCompanyInput continuam aceitando taxRegime/simpleNational/specialRegime (compat de API),
  // mas Company.create/update os IGNORAM; CompanyProps perde taxRegime/simpleNational/specialRegime.
  // company.service.ts
  create(input, tenantId, environment): Promise<Company>            // grava perfil inicial (validFrom = hoje, source 'company_api', unreviewed)
  update(id, input, tenantId, environment): Promise<Company>        // se algum campo de regime mudou: append de novo perfil (validFrom = hoje)
  currentRegime(companyId: string, tenantId: string): Promise<{ taxRegime: TaxRegime | null; simpleNational: boolean; specialRegime: string | null }>
  ```
  A resposta HTTP da company continua expondo `taxRegime`, `simpleNational`, `specialRegime` (lidos do perfil vigente) — contrato público intacto.

- [ ] **Step 1: Write failing tests** em `company.service.spec.ts` (mock de `CompanyFiscalProfileService`):

```ts
it('create writes the initial fiscal profile from the request regime', async () => {
  await service.create({ legalName: 'X', taxId: validCnpj, taxRegime: 'Simples Nacional', simpleNational: true, specialRegime: undefined, municipalityCode: '3550308' }, tenantId, 'test');
  expect(profiles.record).toHaveBeenCalledWith(expect.any(String), tenantId, expect.objectContaining({
    taxRegime: 'SIMPLES_NACIONAL', simpleNational: true, source: 'company_api', reviewStatus: 'unreviewed',
    validFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  }));
});

it('update appends a new profile only when the regime changed', async () => {
  profiles.current.mockResolvedValue({ taxRegime: 'MEI', simpleNational: false, specialTaxRegime: null, /* … */ });
  await service.update(id, { taxRegime: 'Simples Nacional' }, tenantId, 'test');
  expect(profiles.record).toHaveBeenCalledTimes(1);
  profiles.record.mockClear();
  await service.update(id, { legalName: 'Novo nome' }, tenantId, 'test');
  expect(profiles.record).not.toHaveBeenCalled();
});

it('update does not append when the requested regime equals the current one', async () => { /* same regime → no record */ });
```
E em `company.spec.ts`: `Company.create` sem `taxRegime` não lança mais; `toSnapshot()` não contém as três chaves; `update({ taxRegime })` não altera o snapshot.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn jest src/modules/company`
Expected: FAIL.

- [ ] **Step 3: Implement**

`company.ts`: remova `taxRegime`, `simpleNational`, `specialRegime` de `CompanyProps`, de `Company.create` (inclusive o `throw` de `taxRegime` obrigatório — a obrigatoriedade passa para o `CompanyDomainService`/DTO, que já valida `taxRegime` em `validateFiscalDefaults`), dos getters e de `update()`. `CreateCompanyInput`/`UpdateCompanyInput` **mantêm** os campos (compat com o serviço). Exporte `CompanyRegimeInput`.

`company.orm-entity.ts` e `company.mapper.ts`: remova as três colunas/propriedades.

`1791781000000-DropCompanyRegimeColumns.ts`:
```ts
async up(runner) {
  const s = schema(runner);
  await runner.query(`ALTER TABLE ${s}.nfse_companies DROP COLUMN tax_regime, DROP COLUMN simple_national, DROP COLUMN special_regime`);
}
async down(runner) {
  const s = schema(runner);
  await runner.query(`ALTER TABLE ${s}.nfse_companies ADD COLUMN tax_regime varchar(30) NOT NULL DEFAULT 'Simples Nacional', ADD COLUMN simple_national boolean NOT NULL DEFAULT false, ADD COLUMN special_regime varchar(50)`);
  await runner.query(`UPDATE ${s}.nfse_companies c SET
      tax_regime = CASE p.tax_regime WHEN 'MEI' THEN 'MEI' WHEN 'LUCRO_PRESUMIDO' THEN 'Lucro Presumido' WHEN 'LUCRO_REAL' THEN 'Lucro Real' ELSE 'Simples Nacional' END,
      simple_national = p.simple_national, special_regime = p.special_tax_regime
    FROM ${s}.company_fiscal_profiles p WHERE p.company_id = c.id AND p.valid_until IS NULL`);
}
```
(Use o mesmo helper `schema()` da migration anterior.) O `down` é best-effort; documente no cabeçalho.

`company.service.ts`: injete `CompanyFiscalProfileService`. Em `create`, depois de salvar a empresa (live: `saveWithLimit`; test: `save`), chame:
```ts
await this.profiles.record(company.id, tenantId, {
  taxRegime: regimeKindFromLegacy(input.taxRegime),
  simpleNational: input.simpleNational ?? false,
  specialTaxRegime: input.specialRegime?.trim() || null,
  ibsCbsRegularOption: false, ibsCbsRegularFrom: null,
  validFrom: todayInSaoPaulo(), source: 'company_api', reviewStatus: 'unreviewed', reviewedBy: null,
});
```
com `todayInSaoPaulo()` = `DateTime.now().setZone('America/Sao_Paulo').toISODate()!` em `shared/dates/date-time.ts` (adicione a função exportada `todayInEstablishmentTimezone()` ali e use-a). Em `update`, se `input.taxRegime`/`simpleNational`/`specialRegime` foram enviados, compare com `await this.profiles.current(id, tenantId)`; se diferirem, `record` com os valores mesclados (campos não enviados herdam do perfil atual, incluindo `ibsCbsRegularOption/From`). Adicione `currentRegime()`.

`company.controller.ts`: `toView(company, hasCert, regime)` mescla `{ taxRegime, simpleNational, specialRegime }` no objeto; `create/findById/update` obtêm `regime` via `companyService.currentRegime`. Para `list`, busque em lote: adicione `CompanyFiscalProfileService.currentByCompanyIds(ids, tenantId): Promise<Map<string, CompanyFiscalProfile>>` (um `SELECT … WHERE company_id = ANY($1) AND valid_until IS NULL`) e use-o para evitar N+1.

`nfse-workflow.service.ts` (`payload()`): substitua `company.taxRegime`/`company.specialRegime` por uma leitura de `FiscalProfileReader`-like **temporária**: injete `CompanyFiscalProfileService` e use `findEffective` na `competenceDate` da invoice (a Task 18 troca isso pelo snapshot quando a engine estiver ligada). Mapeamento: `MEI → opSimpNac 2`, `SIMPLES_NACIONAL → 3`, demais `1`; `regEspTrib: Number(profile.specialTaxRegime ?? 0)`. Se não houver perfil efetivo, lance `Error('Fiscal profile is missing for the competence date')` (a invoice falhará pelo caminho de erro existente).

Ajuste todos os specs/fixtures listados em **Files** removendo as colunas/propriedades dos inserts SQL e dos objetos `CompanyProps`, e adaptando asserts. (`company.spec.ts` tem ~38 referências: apague as asserts das três propriedades e mantenha o restante.)

- [ ] **Step 4: Run to verify they pass**

Run: `yarn jest src/modules/company src/modules/invoice src/modules/certificate && yarn typecheck && yarn typecheck:tests && MIGRATION_TEST_DATABASE_URL=… yarn jest postgres.integration`
Expected: PASS. Rode também `yarn test:e2e` se o ambiente local permitir; falhas no e2e por colunas removidas devem ser corrigidas nos arquivos de `test/`.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "refactor(company): move tax regime to the historical fiscal profile"
```

---

## Task 5: Catálogo de serviços fiscais da empresa e endpoints de perfil fiscal

**Files:**
- Modify: `src/infra/database/rls-tables.ts` (+ `'company_service_tax_profiles'`), `tenant-rls.postgres.integration.spec.ts` (19)
- Create: `src/infra/database/migrations/1791790000000-CreateCompanyServiceTaxProfiles.ts`
- Create: `src/modules/company/domain/service-tax-profile.repository.ts`
- Create: `src/modules/company/infra/company-service-tax-profile.orm-entity.ts`, `typeorm-company-service-tax-profile.repository.ts`
- Create: `src/modules/company/application/company-service-tax-profile.service.ts`
- Create: `src/modules/company/http/company-fiscal.dto.ts`, `company-fiscal.controller.ts`
- Modify: `src/modules/company/company.module.ts`
- Test: service spec (unit), repository integration spec, controller spec (`company-fiscal.controller.spec.ts`)

**Interfaces:**
- Consumes: `CompanyServiceTaxProfile` e tipos (Task 1), `CompanyFiscalProfileService` (Task 3).
- Produces:
  ```ts
  export type NewServiceTaxProfile = Omit<CompanyServiceTaxProfile, 'id' | 'tenantId' | 'companyId' | 'createdAt'>;
  export abstract class IServiceTaxProfileRepository {
    create(companyId: string, tenantId: string, input: NewServiceTaxProfile): Promise<CompanyServiceTaxProfile>;
    update(id: string, companyId: string, tenantId: string, patch: Partial<NewServiceTaxProfile>): Promise<CompanyServiceTaxProfile>;
    findById(id: string, companyId: string, tenantId: string): Promise<CompanyServiceTaxProfile | null>;
    findEffectiveByCode(companyId: string, tenantId: string, serviceCode: string, date: string): Promise<CompanyServiceTaxProfile[]>;
    list(companyId: string, tenantId: string): Promise<CompanyServiceTaxProfile[]>;
  }
  ```
  HTTP: `GET /v1/companies/:id/fiscal-profile` (lista histórico), `PUT /v1/companies/:id/fiscal-profile` (cria vigência; body: `taxRegime`, `simpleNational?`, `specialTaxRegime?`, `ibsCbsRegularOption?`, `ibsCbsRegularFrom?`, `validFrom?` (padrão hoje), `confirm?: boolean`), `POST /v1/companies/:id/fiscal-profile/:profileId/approve`, `GET/POST/PATCH /v1/companies/:id/fiscal-services[/:serviceId]`. Permissões: `nfse.companies.view` (GET) e `nfse.companies.manage` (demais). `PUT` com `confirm: true` ⇒ `reviewStatus: 'approved'`, `reviewedBy: authContext.authUserId`.

- [ ] **Step 1: Migration** `1791790000000-CreateCompanyServiceTaxProfiles.ts` (padrão da Task 3): tabela `company_service_tax_profiles` com `id, tenant_id, company_id, name varchar(120), service_code varchar(6), municipal_service_code varchar(20), nbs_code varchar(9), cst varchar(3), class_code varchar(6), operation_indicator varchar(6), operation_nature varchar(15) NOT NULL DEFAULT 'SERVICE', regime_applicability text[] NOT NULL DEFAULT '{}', incidence_municipality_code varchar(7), iss_taxation varchar(10), iss_rate numeric(8,5), iss_withholding_default boolean NOT NULL DEFAULT false, withholding_policy varchar(15) NOT NULL DEFAULT 'UNKNOWN', withholding_rates jsonb NOT NULL DEFAULT '{}', effective_from date NOT NULL, effective_until date, classification_source varchar(30) NOT NULL, review_status varchar(12) NOT NULL DEFAULT 'unreviewed', catalog_version varchar(40), created_at`. CHECKs: `service_code ~ '^[0-9]{6}$'`, `operation_nature IN ('SERVICE','GOODS','MIXED','PARTNER_SALON')`, `iss_taxation IN ('NORMAL','FIXED','EXEMPT') OR NULL`, `withholding_policy IN ('UNKNOWN','NONE_CONFIRMED','CONFIGURED')`, `iss_rate BETWEEN 0 AND 100`, `effective_until > effective_from`. Índices: `(company_id, service_code, effective_from)`, `(tenant_id)`. RLS idêntica.

- [ ] **Step 2: Write failing tests**

Serviço (unit, repositório fake): `create` rejeita `serviceCode` fora de `^\d{6}$` com `FiscalValidationError` (campo `serviceCode`); `issTaxation = 'NORMAL'` sem `issRate` é aceito (a engine acusará `MISSING_CONFIGURATION`; a configuração pode ser incremental); `withholdingPolicy = 'CONFIGURED'` exige ao menos uma taxa em `withholdingRates` (`FiscalValidationError`); taxas são strings numéricas ≥ 0 e ≤ 100; `issRate` idem. Controller: `PUT fiscal-profile` com `confirm: true` chama `record` com `reviewStatus: 'approved'` e `reviewedBy` = `authContext.authUserId`; sem `confirm` grava `unreviewed`; `validFrom` omitido usa `todayInEstablishmentTimezone()`. Repositório (integração): `findEffectiveByCode` respeita `effective_from/until` (limites inclusivo/exclusivo) e devolve **todas** as linhas candidatas (a ambiguidade é decidida pelo classificador).

- [ ] **Step 3: Run to verify they fail** — `yarn jest src/modules/company` → FAIL.

- [ ] **Step 4: Implement** — repositório (SQL parametrizado, mesma estrutura do da Task 3, conversão de `numeric` para string via `::text` no SELECT para não perder precisão: `iss_rate::text AS iss_rate`), serviço com validações acima (reutilize `FiscalValidationError`/`FiscalIssue`; código `'invalid'` para campos fora do padrão e `'required'` onde faltar), DTOs com `class-validator` (`@IsIn(TAX_REGIME_KINDS)`, `@Matches(/^\d{6}$/)` para `serviceCode`, `@IsDateString`, etc.) e controller seguindo `company.controller.ts` (`@UseGuards(ExecutionEnvironmentGuard)`, `@ApiKeyEndpoint()`, `@RequirePermission(...)`, retorno `data(...)`). Antes de operar, cada rota valida que a empresa existe e pertence ao tenant/ambiente via `CompanyService.findById`.

- [ ] **Step 5: Run to verify they pass** — `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/company src/infra/database && yarn typecheck` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(company): add fiscal service catalog and fiscal profile endpoints"`

---

## Task 6: Catálogo oficial de cTribNac (arquivo versionado) e port de catálogo

**Files:**
- Create: `src/modules/invoice/domain/fiscal/classification/fiscal-catalog.port.ts`
- Create: `src/modules/invoice/domain/fiscal/classification/ctribnac-catalog.ts`
- Create: `src/modules/invoice/infra/fiscal/catalog/ctribnac.json` (gerado)
- Create: `scripts/build-ctribnac-catalog.ts`
- Test: `ctribnac-catalog.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CatalogFile { kind: 'ctribnac'; version: string; sourceUrl: string; publishedAt: string; checksum: string; entries: Array<{ code: string; description: string }> }
  export interface CatalogLookup { version: string; found: boolean }
  export abstract class IFiscalCatalog {
    lookupServiceCode(code: string): CatalogLookup;                       // cTribNac
    validateClassification(input: { serviceCode: string; nbsCode: string | null; cst: string | null; classCode: string | null; operationIndicator: string | null }, date: string):
      | { status: 'validated'; versions: Record<string, string> }
      | { status: 'unavailable'; reason: string }                          // spec 2: NBS/CST/cClassTrib catalogs are not loaded
      | { status: 'invalid'; issues: Array<{ field: string; reason: string }> }
      | { status: 'ambiguous'; candidates: Array<Record<string, string>> };
  }
  ```

- [ ] **Step 1 (obtenção da fonte oficial — manual, uma vez):** baixe da página `https://www.gov.br/nfse/pt-br/mei-e-demais-empresas/codigos-de-tributacao-nacional-nbs` a planilha/CSV oficial da lista nacional de serviços (cTribNac, 6 dígitos). Abra, identifique o nome das colunas de código e descrição, exporte para CSV UTF-8 em um diretório **fora do repositório** e registre a URL exata do arquivo e a data de publicação. Se o arquivo contiver hierarquia (item/subitem/desdobro), o `code` do catálogo é o código de 6 dígitos completo.

- [ ] **Step 2: Write the failing tests** — `ctribnac-catalog.spec.ts`

```ts
import { JsonFiscalCatalog } from './ctribnac-catalog';

const file = { kind: 'ctribnac' as const, version: '2026-10-r1', sourceUrl: 'https://example.invalid/test', publishedAt: '2026-10-01', checksum: 'x',
  entries: [{ code: '060101', description: 'Cabeleireiros' }, { code: '010601', description: 'Assessoria e consultoria em informática' }] };

describe('JsonFiscalCatalog', () => {
  const catalog = new JsonFiscalCatalog(file);
  it('finds listed service codes with the catalog version', () => {
    expect(catalog.lookupServiceCode('060101')).toEqual({ version: '2026-10-r1', found: true });
  });
  it('reports unknown codes', () => expect(catalog.lookupServiceCode('999999').found).toBe(false));
  it('rejects malformed codes', () => expect(catalog.lookupServiceCode('0601').found).toBe(false));
  it('does not validate NBS/CST/cClassTrib while those catalogs are not loaded', () => {
    expect(catalog.validateClassification({ serviceCode: '060101', nbsCode: '123456789', cst: null, classCode: null, operationIndicator: null }, '2026-10-13'))
      .toEqual({ status: 'unavailable', reason: expect.stringContaining('NBS/CST/cClassTrib') });
  });
  it('refuses a malformed file', () => {
    expect(() => new JsonFiscalCatalog({ ...file, entries: [{ code: '12', description: 'x' }] })).toThrow('Invalid cTribNac code');
    expect(() => new JsonFiscalCatalog({ ...file, entries: [file.entries[0], file.entries[0]] })).toThrow('Duplicate cTribNac code');
  });
});
```
(Os nomes `Cabeleireiros`/`Assessoria…` no fixture do teste são apenas rótulos locais; o teste usa os códigos reais `060101`/`010601` citados no briefing.)

- [ ] **Step 3: Run to verify it fails** — `yarn jest ctribnac-catalog` → FAIL.

- [ ] **Step 4: Implement**

`fiscal-catalog.port.ts`: `CatalogFile`, `CatalogLookup`, `abstract class IFiscalCatalog` (conforme Interfaces) e `export const FISCAL_CATALOG = IFiscalCatalog;` não — use a própria classe abstrata como token (padrão `ICompanyRepository`).

`ctribnac-catalog.ts`:
```ts
export class JsonFiscalCatalog extends IFiscalCatalog {
  private readonly codes = new Map<string, string>();
  constructor(private readonly file: CatalogFile) {
    super();
    for (const entry of file.entries) {
      if (!/^\d{6}$/.test(entry.code)) throw new Error(`Invalid cTribNac code: ${entry.code}`);
      if (this.codes.has(entry.code)) throw new Error(`Duplicate cTribNac code: ${entry.code}`);
      this.codes.set(entry.code, entry.description);
    }
  }
  lookupServiceCode(code: string): CatalogLookup {
    return { version: this.file.version, found: /^\d{6}$/.test(code) && this.codes.has(code) };
  }
  validateClassification(): ReturnType<IFiscalCatalog['validateClassification']> {
    return { status: 'unavailable', reason: 'NBS/CST/cClassTrib/cIndOp catalogs are not loaded yet (Spec 3)' };
  }
}
```

`scripts/build-ctribnac-catalog.ts` (executável com `ts-node`): lê `--input <csv>`, `--source-url`, `--published-at`, `--version`, `--code-column <n>` (padrão 0), `--description-column <n>` (padrão 1), `--delimiter` (`;` padrão); ignora cabeçalho e linhas cujo código não case `^\d{6}$` (relatando a contagem ignorada); calcula `checksum` = sha256 do conteúdo do CSV; escreve `src/modules/invoice/infra/fiscal/catalog/ctribnac.json` ordenado por código. Rode:
```bash
yarn ts-node -r tsconfig-paths/register scripts/build-ctribnac-catalog.ts --input /caminho/lista.csv --source-url '<URL oficial>' --published-at <YYYY-MM-DD> --version 2026-10-r1
```
Verifique manualmente que `060101`, `060201` e `010601` estão no JSON gerado (`grep -c '"060101"' …`). Se algum não estiver, **pare** e confirme a planilha/colunas antes de seguir (os exemplos do briefing devem existir no catálogo oficial).

Provider Nest: em `invoice.module.ts` (Task 17) `{ provide: IFiscalCatalog, useFactory: () => new JsonFiscalCatalog(JSON.parse(readFileSync(join(__dirname, 'infra/fiscal/catalog/ctribnac.json'), 'utf8'))) }`. Garanta que o JSON seja copiado no build: adicione `"assets": [{ "include": "modules/invoice/infra/fiscal/catalog/*.json", "outDir": "dist" }]` em `nest-cli.json` (`compilerOptions.assets`) e confirme com `yarn build && ls dist/modules/invoice/infra/fiscal/catalog` e `scripts/verify-build-artifacts.mjs`.

- [ ] **Step 5: Run to verify it passes** — `yarn jest ctribnac-catalog && yarn typecheck` → PASS.

- [ ] **Step 6: Commit** — `git add scripts src nest-cli.json && git commit -m "feat(fiscal): add versioned cTribNac catalog and catalog port"`

---

## Task 7: TaxRule e TaxTransitionPolicy (regras versionadas como código)

**Files:**
- Create: `src/modules/invoice/domain/fiscal/policies/tax-rule.ts`
- Create: `src/modules/invoice/domain/fiscal/policies/rules/index.ts`
- Create: `src/modules/invoice/domain/fiscal/policies/tax-transition.policy.ts`
- Test: `tax-transition.policy.spec.ts`
- Create: `docs/fiscal/rules-verification.md`

**Interfaces:**
- Produces:
  ```ts
  export type RuleStatus = 'published' | 'homologated' | 'in_production';
  export interface TaxRuleBase { ruleKey: string; validFrom: string; validUntil: string | null; legalReference: string; sourceUrl: string; status: RuleStatus }
  export type TaxRule =
    | (TaxRuleBase & { ruleKey: 'ibscbs.test-phase'; parameters: { cbsNominalPercent: string; ibsNominalPercent: string; collectionWaived: boolean; excludesSimplesNacional: boolean } })
    | (TaxRuleBase & { ruleKey: 'nfse.ibscbs-information'; parameters: { generalFrom: string; specificCategoriesFrom: string; sefinToleranceUntil: string; specificCategoryServiceCodes: string[] } })
    | (TaxRuleBase & { ruleKey: 'simples.ibscbs-effective'; parameters: { effectiveFrom: string } })
    | (TaxRuleBase & { ruleKey: 'rounding.default'; parameters: { mode: 'HALF_UP'; places: 2 } });
  export const RULES_VERSION: string;   // e.g. '2026.10-r1'
  export class TaxTransitionPolicy {
    constructor(rules?: readonly TaxRule[]);
    select<K extends TaxRule['ruleKey']>(ruleKey: K, date: string): Result<Extract<TaxRule, { ruleKey: K }>, FiscalError>;  // TAX_RULE_NOT_EFFECTIVE when none/ambiguous
    ibsCbsInformation(serviceCode: string, date: string): { phase: 'NOT_YET_REQUIRED' | 'REQUIRED'; toleratedBySefin: boolean; rule: Extract<TaxRule, { ruleKey: 'nfse.ibscbs-information' }> };
    readonly rulesVersion: string;
  }
  ```

- [ ] **Step 1: Verificação jurídica (obrigatória antes de codificar valores).** Leia nas fontes oficiais e registre em `docs/fiscal/rules-verification.md` (um bloco por regra: fonte, artigo/trecho, data da consulta, valor extraído, quem conferiu): LC 214/2025 (alíquotas de teste CBS 0,9% / IBS 0,1% em 2026 e dispensa de recolhimento), LC 227/2026, LC 116/2003 (base de cálculo e local de incidência), Ato Conjunto RFB/CGIBS nº 4/2026 (marcos de 01/10/2026 e 01/12/2026; lista das categorias específicas), orientação CGNFS-e sobre tolerância até 31/12/2026, Resolução CGSN sobre NFS-e do Simples (01/11/2026) e efeitos de IBS/CBS do Simples em 01/01/2027. **Se algum valor abaixo divergir do texto oficial, o texto oficial vence; corrija o código e registre a divergência.** Se a lista das categorias específicas não puder ser extraída, deixe `specificCategoryServiceCodes: []` e registre a limitação no documento (efeito: todos os serviços são tratados pela regra geral — conservador).

- [ ] **Step 2: Write the failing tests** — `tax-transition.policy.spec.ts`

```ts
import { TaxTransitionPolicy } from './tax-transition.policy';
import type { TaxRule } from './tax-rule';

describe('TaxTransitionPolicy', () => {
  const policy = new TaxTransitionPolicy();

  it('selects the 2026 test-phase rule by competence date', () => {
    const rule = policy.select('ibscbs.test-phase', '2026-10-13');
    expect(rule.ok && rule.value.parameters).toMatchObject({ cbsNominalPercent: '0.9', ibsNominalPercent: '0.1', collectionWaived: true, excludesSimplesNacional: true });
  });
  it.each(['2025-12-31', '2027-01-01'])('has no test-phase rule on %s', (date) => {
    expect(policy.select('ibscbs.test-phase', date)).toMatchObject({ ok: false, error: { code: 'TAX_RULE_NOT_EFFECTIVE', category: 'CONFIGURATION' } });
  });
  it('boundaries are inclusive at validFrom and exclusive at validUntil', () => {
    const rules: TaxRule[] = [{ ruleKey: 'rounding.default', validFrom: '2026-01-01', validUntil: '2026-07-01', legalReference: 't', sourceUrl: 'u', status: 'published', parameters: { mode: 'HALF_UP', places: 2 } }];
    const p = new TaxTransitionPolicy(rules);
    expect(p.select('rounding.default', '2026-01-01').ok).toBe(true);
    expect(p.select('rounding.default', '2026-06-30').ok).toBe(true);
    expect(p.select('rounding.default', '2026-07-01').ok).toBe(false);
  });
  it('refuses overlapping rules with the same key at construction', () => {
    const base = { ruleKey: 'rounding.default' as const, legalReference: 't', sourceUrl: 'u', status: 'published' as const, parameters: { mode: 'HALF_UP' as const, places: 2 as const } };
    expect(() => new TaxTransitionPolicy([{ ...base, validFrom: '2026-01-01', validUntil: null }, { ...base, validFrom: '2026-06-01', validUntil: null }])).toThrow('Overlapping tax rules');
  });
  it('information obligation: not required before 2026-10-01, required after, tolerated until 2026-12-31', () => {
    expect(policy.ibsCbsInformation('060101', '2026-09-30')).toMatchObject({ phase: 'NOT_YET_REQUIRED' });
    expect(policy.ibsCbsInformation('060101', '2026-10-13')).toMatchObject({ phase: 'REQUIRED', toleratedBySefin: true });
    expect(policy.ibsCbsInformation('060101', '2026-12-31')).toMatchObject({ phase: 'REQUIRED', toleratedBySefin: true });
    expect(policy.ibsCbsInformation('060101', '2027-01-01')).toMatchObject({ phase: 'REQUIRED', toleratedBySefin: false });
  });
  it('exposes a stable rules version', () => expect(policy.rulesVersion).toMatch(/^\d{4}\.\d{2}-r\d+$/));
});
```
(Os valores do teste refletem o briefing; se o Step 1 mudar um valor oficial, atualize o teste junto.)

- [ ] **Step 3: Run to verify it fails** — `yarn jest tax-transition` → FAIL.

- [ ] **Step 4: Implement**

`tax-rule.ts` com os tipos de **Interfaces**. `rules/index.ts`:
```ts
import type { TaxRule } from '../tax-rule';

export const RULES_VERSION = '2026.10-r1';

export const TAX_RULES: readonly TaxRule[] = [
  {
    ruleKey: 'ibscbs.test-phase',
    validFrom: '2026-01-01', validUntil: '2027-01-01',
    legalReference: 'LC 214/2025 (fase de teste 2026)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm',
    status: 'published',
    parameters: { cbsNominalPercent: '0.9', ibsNominalPercent: '0.1', collectionWaived: true, excludesSimplesNacional: true },
  },
  {
    ruleKey: 'nfse.ibscbs-information',
    validFrom: '2026-10-01', validUntil: null,
    legalReference: 'Ato Conjunto RFB/CGIBS nº 4/2026; orientação CGNFS-e de 07/08/2026',
    sourceUrl: 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc',
    status: 'published',
    parameters: { generalFrom: '2026-10-01', specificCategoriesFrom: '2026-12-01', sefinToleranceUntil: '2026-12-31', specificCategoryServiceCodes: [] },
  },
  {
    ruleKey: 'simples.ibscbs-effective',
    validFrom: '2027-01-01', validUntil: null,
    legalReference: 'LC 214/2025 e LC 227/2026 (Simples Nacional)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm',
    status: 'published',
    parameters: { effectiveFrom: '2027-01-01' },
  },
  {
    ruleKey: 'rounding.default',
    validFrom: '2026-01-01', validUntil: null,
    legalReference: 'Leiaute NFS-e Nacional (RTC v1.01): valores monetários com 2 casas',
    sourceUrl: 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc',
    status: 'published',
    parameters: { mode: 'HALF_UP', places: 2 },
  },
];
```
`tax-transition.policy.ts`: o construtor valida sobreposição por `ruleKey` (ordena por `validFrom`; sobreposição quando `a.validUntil === null || a.validUntil > b.validFrom`) e lança `Error('Overlapping tax rules for <key>')`; `select` filtra por `validFrom <= date && (validUntil === null || date < validUntil)` e devolve `err(fiscalError({ code: 'TAX_RULE_NOT_EFFECTIVE', category: 'CONFIGURATION', message, details: { ruleKey, date } }))` se nenhuma; `ibsCbsInformation(serviceCode, date)`: pega a regra `nfse.ibscbs-information` (se não houver para a data → `phase: 'NOT_YET_REQUIRED'` com a regra mais antiga como referência; para isso use a primeira regra do array); `phase` é `REQUIRED` quando `date >= generalFrom` para serviços fora de `specificCategoryServiceCodes`, e `date >= specificCategoriesFrom` para serviços dentro da lista; `toleratedBySefin = date <= sefinToleranceUntil`. `rulesVersion` = `RULES_VERSION`.

- [ ] **Step 5: Run to verify it passes** — `yarn jest tax-transition && yarn typecheck` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(fiscal): add versioned tax rules and transition policy"`

---

## Task 8: Specifications e Strategies

**Files:**
- Create: `src/modules/invoice/domain/fiscal/applicability/specifications.ts`
- Create: `src/modules/invoice/domain/fiscal/strategies/tax-strategy.ts`
- Create: `.../strategies/mei-tax.strategy.ts`, `simples-nacional-tax.strategy.ts`, `regular-tax.strategy.ts`, `tax-strategy.resolver.ts`
- Test: `specifications.spec.ts`, `tax-strategy.spec.ts`

**Interfaces:**
- Consumes: `CompanyFiscalProfile`, `ServiceTaxClassification`, `Obligation`, `TaxApplicability`, `TaxTransitionPolicy`, `NormalizedInvoice`.
- Produces:
  ```ts
  export interface SpecificationResult { satisfied: boolean; reason: string }
  export function allowsAnonymousCustomer(input: { regime: TaxRegimeKind; competenceDate: string; operationNature: OperationNature }): SpecificationResult;
  export function requiresIssWithholding(input: { customer: FiscalCustomer | null; classification: ServiceTaxClassification }): SpecificationResult;
  export function requiresIbsCbs(input: { competenceDate: string; serviceCode: string; policy: TaxTransitionPolicy }): SpecificationResult;
  export function requiresSpecialTreatment(input: { classification: ServiceTaxClassification; profile: CompanyFiscalProfile }): SpecificationResult;

  export interface StrategyInput { invoice: NormalizedInvoice; profile: CompanyFiscalProfile; classification: ServiceTaxClassification; policy: TaxTransitionPolicy }
  export interface TaxStrategy { readonly name: string; supports(profile: CompanyFiscalProfile, competenceDate: string): boolean; plan(input: StrategyInput): Result<Omit<TaxApplicability, 'strategy' | 'rulesVersion' | 'legalReferences'>, FiscalError> }
  export class TaxStrategyResolver { constructor(strategies: readonly TaxStrategy[]); resolve(profile: CompanyFiscalProfile, competenceDate: string): Result<TaxStrategy, FiscalError> }  // TAX_REGIME_UNSUPPORTED when 0 or >1
  ```

Regras do `plan` (fonte da verdade da aplicabilidade; cada ramo tem teste):

- **Comum (helper `commonObligations`)**: `specialTreatment = requiresSpecialTreatment(...)`: `operationNature === 'PARTNER_SALON'` ⇒ `UNSUPPORTED` ("partner-salon scenario not supported; fiscal review required"); `operationNature === 'GOODS'|'MIXED'` ⇒ erro imediato `OPERATION_DOCUMENT_UNSUPPORTED` (categoria `UNSUPPORTED`, mensagem "goods/mixed operations require NF-e/NFC-e").
  - `issWithheld`: `classification.iss.withholdingDefault && customer?.kind === 'CNPJ'` ⇒ `REQUIRED`; senão `NOT_APPLICABLE` (razão: "no ISS withholding configured for this customer/service").
  - `federalWithholding`: cliente `null` ou `CPF` ⇒ `NOT_APPLICABLE`; cliente `CNPJ` + `policy NONE_CONFIRMED` ⇒ `NOT_APPLICABLE`; `CONFIGURED` ⇒ `REQUIRED`; `UNKNOWN` ⇒ `MISSING_CONFIGURATION` (`missingFields: ['service.withholdingPolicy']`).
  - `customerRequired`: `!allowsAnonymousCustomer(...).satisfied`.
- **MEI** (`supports`: `taxRegime === 'MEI'`): `iss = NOT_APPLICABLE` ("ISS recolhido no DAS-MEI"); IBS/CBS: `competenceDate < '2027-01-01'` ⇒ `NOT_APPLICABLE` ("MEI não destaca IBS/CBS na fase de teste de 2026"); `>= 2027-01-01` ⇒ `UNSUPPORTED` ("regras de IBS/CBS do MEI em 2027 ainda não carregadas"). `allowsAnonymousCustomer`: MEI com `SERVICE` ⇒ satisfeito.
- **Simples Nacional** (`taxRegime === 'SIMPLES_NACIONAL'`): `iss = NOT_APPLICABLE` ("ISS recolhido no DAS"); `competenceDate < simples.ibscbs-effective.effectiveFrom` ⇒ IBS/CBS `NOT_APPLICABLE` ("regras de IBS/CBS do Simples produzem efeitos a partir de 01/01/2027"); a partir daí: `profile.ibsCbsRegularOption && ibsCbsRegularFrom <= competenceDate` ⇒ delega à lógica **regular** (ISS/IBS/CBS como no Regular); sem opção ⇒ `UNSUPPORTED` ("IBS/CBS dentro do DAS em 2027 ainda não suportado"). `allowsAnonymousCustomer`: satisfeito para `SERVICE`.
- **Regular** (`LUCRO_PRESUMIDO | LUCRO_REAL`, ou Simples com opção regular): `iss`: `issTaxation === 'EXEMPT'` ⇒ `NOT_APPLICABLE`; `'FIXED'` ⇒ `UNSUPPORTED`; `'NORMAL'` com `rate` ⇒ `REQUIRED`; `'NORMAL'` sem `rate` ou `null` ⇒ `MISSING_CONFIGURATION` (`missingFields: ['service.iss.rate']`). IBS/CBS via `requiresIbsCbs`: `NOT_YET_REQUIRED` ⇒ `NOT_APPLICABLE` ("obrigação de informação ainda não vigente"); `REQUIRED` ⇒ `REQUIRED` para `cbs` e `ibs`; `collectionWaived` = regra `ibscbs.test-phase` vigente na data (`true` em 2026), `false` fora da fase de teste. `allowsAnonymousCustomer`: **não** satisfeito (regime regular exige tomador identificado). Regimes `OUTRO_REGIME`/`UNKNOWN` não são suportados por nenhuma estratégia ⇒ `TAX_REGIME_UNSUPPORTED`.

- [ ] **Step 1: Write the failing tests** — `specifications.spec.ts` e `tax-strategy.spec.ts` cobrem cada linha acima. Exemplos obrigatórios:

```ts
describe('strategies', () => {
  const policy = new TaxTransitionPolicy();
  const resolver = new TaxStrategyResolver([new MeiTaxStrategy(), new SimplesNacionalTaxStrategy(), new RegularTaxStrategy()]);
  const plan = (profile: Partial<CompanyFiscalProfile>, over: { competenceDate?: string; customer?: FiscalCustomer | null; classification?: Partial<ServiceTaxClassification> } = {}) => {
    const full = fullProfile(profile), date = over.competenceDate ?? '2026-10-13';
    const strategy = resolver.resolve(full, date);
    if (!strategy.ok) return strategy;
    return strategy.value.plan({ invoice: invoiceWith(date, over.customer ?? null), profile: full, classification: classificationWith(over.classification), policy });
  };

  it('MEI 2026: no ISS, no IBS/CBS, anonymous customer allowed', () => {
    const r = plan({ taxRegime: 'MEI' });
    expect(r.ok && r.value).toMatchObject({ iss: { status: 'NOT_APPLICABLE' }, cbs: { status: 'NOT_APPLICABLE' }, ibs: { status: 'NOT_APPLICABLE' }, customerRequired: false });
  });
  it('MEI 2027: IBS/CBS UNSUPPORTED (never NOT_APPLICABLE)', () => {
    const r = plan({ taxRegime: 'MEI' }, { competenceDate: '2027-02-01' });
    expect(r.ok && r.value.cbs.status).toBe('UNSUPPORTED');
  });
  it('Simples 2026: no test-phase rate applied', () => {
    const r = plan({ taxRegime: 'SIMPLES_NACIONAL', simpleNational: true }, { competenceDate: '2026-11-15' });
    expect(r.ok && r.value).toMatchObject({ cbs: { status: 'NOT_APPLICABLE' }, ibs: { status: 'NOT_APPLICABLE' }, iss: { status: 'NOT_APPLICABLE' } });
  });
  it('Simples 2027 without regular option: UNSUPPORTED', ...);
  it('Simples 2027 with regular option valid from the competence: behaves as regular', ...);
  it('Regular 2026: IBS/CBS REQUIRED with collection waived; customer required', () => {
    const r = plan({ taxRegime: 'LUCRO_PRESUMIDO' }, { customer: cnpjCustomer, classification: { iss: { taxation: 'NORMAL', rate: '3', withholdingDefault: false, incidenceMunicipalityCode: null }, withholding: { policy: 'NONE_CONFIRMED', rates: {} } } });
    expect(r.ok && r.value).toMatchObject({ iss: { status: 'REQUIRED' }, cbs: { status: 'REQUIRED' }, collectionWaived: true, customerRequired: true });
  });
  it('Regular 2027: collectionWaived false', ...);
  it('Regular without ISS rate: MISSING_CONFIGURATION', ...);
  it('Regular FIXED ISS: UNSUPPORTED', ...);
  it('Regular before 2026-10-01: IBS/CBS NOT_APPLICABLE (obligation not yet effective)', ...);
  it('CNPJ customer with UNKNOWN withholding policy: federalWithholding MISSING_CONFIGURATION', ...);
  it('CPF customer: federalWithholding NOT_APPLICABLE', ...);
  it('ISS withheld when configured and customer is CNPJ', ...);
  it('GOODS nature blocks with OPERATION_DOCUMENT_UNSUPPORTED', () => { expect(plan({ taxRegime: 'MEI' }, { classification: { operationNature: 'GOODS' } })).toMatchObject({ ok: false, error: { code: 'OPERATION_DOCUMENT_UNSUPPORTED' } }); });
  it('PARTNER_SALON: specialTreatment UNSUPPORTED', ...);
  it('OUTRO_REGIME / UNKNOWN: TAX_REGIME_UNSUPPORTED', () => { expect(resolver.resolve(fullProfile({ taxRegime: 'UNKNOWN' }), '2026-10-13')).toMatchObject({ ok: false, error: { code: 'TAX_REGIME_UNSUPPORTED' } }); });
  it('resolver rejects when two strategies claim the same profile', ...);
});
```
com helpers locais `fullProfile`, `invoiceWith`, `classificationWith`, `cnpjCustomer` no próprio spec (valores completos com defaults neutros; CNPJ do cliente `11222333000181`, válido para o validador).

- [ ] **Step 2: Run to verify they fail** — `yarn jest src/modules/invoice/domain/fiscal/strategies src/modules/invoice/domain/fiscal/applicability` → FAIL.

- [ ] **Step 3: Implement** conforme as regras acima. Estrutura: `commonObligations(input)` em `strategies/common-obligations.ts` (usa as Specifications); `RegularTaxStrategy` expõe `planRegular(input)` reutilizado pela Simples com opção; `supports` de cada estratégia é mutuamente exclusivo (Regular: `LUCRO_PRESUMIDO|LUCRO_REAL`; Simples-com-opção é tratada **dentro** de `SimplesNacionalTaxStrategy.plan`, não como segunda estratégia, para manter a exclusividade). `TaxStrategyResolver.resolve` filtra por `supports`; 0 ⇒ `TAX_REGIME_UNSUPPORTED` (`details: { regime }`), >1 ⇒ `TAX_REGIME_UNSUPPORTED` (`details: { ambiguousStrategies }`).

- [ ] **Step 4: Run to verify they pass** — mesmo comando + `yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add specifications and tax strategies"`

---

## Task 9: Etapa CompanyFiscalProfileResolver

**Files:**
- Create: `src/modules/invoice/domain/fiscal/ports/fiscal-profile.reader.ts`
- Create: `src/modules/invoice/application/fiscal/steps/company-fiscal-profile.step.ts`
- Test: `company-fiscal-profile.step.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export abstract class IFiscalProfileReader {
    findEffective(companyId: string, tenantId: string, date: string): Promise<CompanyFiscalProfile | null>;
    existsAny(companyId: string, tenantId: string): Promise<boolean>;
  }
  export class CompanyFiscalProfileStep implements FiscalStep { readonly name = 'CompanyFiscalProfileResolver'; readonly required = true; }
  ```
  `IFiscalProfileReader` é implementado por um adapter fino em `modules/company` (Task 17 faz o bind `useExisting`): `CompanyFiscalProfileService` ganha `findEffective(companyId, tenantId, date)` e `existsAny` (delegam ao repositório; `existsAny` = `list().length > 0`).

Comportamento: `findEffective` nulo e `existsAny` falso ⇒ `FISCAL_PROFILE_MISSING` (`CONFIGURATION`); nulo mas existe histórico ⇒ `FISCAL_PROFILE_NOT_EFFECTIVE` (`details: { competenceDate }`); `environment === 'live'` e `reviewStatus !== 'approved'` ⇒ `FISCAL_REVIEW_REQUIRED` (`CONFIGURATION`, `details: { profileId, reviewStatus }`); `rejected` bloqueia em qualquer ambiente; `test` com `unreviewed` ⇒ `applied` + warning `FISCAL_PROFILE_UNREVIEWED`.

- [ ] **Step 1: Write the failing tests** — casos: perfil vigente na competência (aplicado, `context.companyProfile` preenchido); **nota de competência passada usa o perfil antigo** (reader fake devolve perfis diferentes por data; competência `2026-02-10` ⇒ regime A, `2026-08-10` ⇒ regime B); sem perfil nenhum ⇒ MISSING; só perfil futuro ⇒ NOT_EFFECTIVE; live+unreviewed ⇒ REVIEW_REQUIRED; live+approved ⇒ ok; test+unreviewed ⇒ ok com warning; `rejected` ⇒ REVIEW_REQUIRED; o step não muta o contexto de entrada.

```ts
it('uses the profile effective on the competence date, not today', async () => {
  const reader = { findEffective: jest.fn(async (_c, _t, date) => date < '2026-06-01' ? profileA : profileB), existsAny: jest.fn() };
  const step = new CompanyFiscalProfileStep(reader as never);
  const early = await step.execute(contextFor({ competenceDate: '2026-02-10' }));
  const late = await step.execute(contextFor({ competenceDate: '2026-08-10' }));
  expect(early.ok && early.value.context.companyProfile?.taxRegime).toBe('MEI');
  expect(late.ok && late.value.context.companyProfile?.taxRegime).toBe('SIMPLES_NACIONAL');
});
```
(`contextFor` = helper em `src/modules/invoice/application/fiscal/steps/testing/context.ts`, **arquivo de teste compartilhado** (`.ts` fora de `*.spec.ts`, excluído do build por `tsconfig.build.json`/`exclude: ["**/testing/**"]` — confirme/ajuste) que monta `FiscalContext` completo com defaults e overrides.)

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

```ts
@Injectable()
export class CompanyFiscalProfileStep implements FiscalStep {
  readonly name = 'CompanyFiscalProfileResolver';
  readonly required = true;
  constructor(private readonly profiles: IFiscalProfileReader) {}

  async execute(context: Readonly<FiscalContext>): Promise<Result<StepOutcome, FiscalError>> {
    const { invoice } = context;
    const profile = await this.profiles.findEffective(invoice.company.id, invoice.tenantId, invoice.competenceDate);
    if (!profile) {
      const hasHistory = await this.profiles.existsAny(invoice.company.id, invoice.tenantId);
      return err(hasHistory
        ? fiscalError({ code: 'FISCAL_PROFILE_NOT_EFFECTIVE', category: 'CONFIGURATION', message: 'No fiscal profile is effective on the competence date', details: { competenceDate: invoice.competenceDate } })
        : fiscalError({ code: 'FISCAL_PROFILE_MISSING', category: 'CONFIGURATION', message: 'Company has no fiscal profile' }));
    }
    if (profile.reviewStatus === 'rejected' || (invoice.environment === 'live' && profile.reviewStatus !== 'approved'))
      return err(fiscalError({ code: 'FISCAL_REVIEW_REQUIRED', category: 'CONFIGURATION', message: 'Fiscal profile requires approval before live emission', details: { profileId: profile.id, reviewStatus: profile.reviewStatus } }));
    const warnings = profile.reviewStatus === 'unreviewed'
      ? [...context.warnings, { code: 'FISCAL_PROFILE_UNREVIEWED', message: 'Fiscal profile is not approved', step: this.name }]
      : context.warnings;
    return ok({ status: 'applied', context: { ...context, companyProfile: profile, warnings } });
  }
}
```

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice/application/fiscal && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add company fiscal profile resolver step"`

---

## Task 10: Etapa ServiceTaxClassifier

**Files:**
- Create: `src/modules/invoice/domain/fiscal/ports/service-profile.reader.ts`
- Create: `src/modules/invoice/domain/fiscal/classification/classify-service.ts` (lógica pura)
- Create: `src/modules/invoice/application/fiscal/steps/service-tax-classifier.step.ts`
- Test: `classify-service.spec.ts`, `service-tax-classifier.step.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export abstract class IServiceProfileReader {
    findById(id: string, companyId: string, tenantId: string): Promise<CompanyServiceTaxProfile | null>;
    findEffectiveByCode(companyId: string, tenantId: string, serviceCode: string, date: string): Promise<CompanyServiceTaxProfile[]>;
  }
  export function classifyService(input: {
    invoice: NormalizedInvoice; profile: CompanyFiscalProfile;
    serviceProfiles: CompanyServiceTaxProfile[];        // already filtered by id or by (code, date)
    requestedProfileId: string | null;
    catalog: IFiscalCatalog;
  }): Result<ServiceTaxClassification, FiscalError>;
  export class ServiceTaxClassifierStep implements FiscalStep { name = 'ServiceTaxClassifier'; required = true }
  ```
  Pré-condição: exige `context.companyProfile` (senão `FISCAL_INTERNAL_ERROR`, `INTERNAL`).

Prioridade e regras de `classifyService`:

1. `cTribNac` precisa existir no catálogo oficial (`catalog.lookupServiceCode`), senão `FISCAL_CLASSIFICATION_INVALID` (`details: { field: 'service.code' }`).
2. **Override explícito** (`invoice.service.fiscal` não vazio): campos informados formam a classificação `source: 'request_override'`; campos faltantes são completados **apenas** a partir do perfil de serviço aprovado correspondente, se houver; nunca de suposições. `catalog.validateClassification(...)`: `invalid` ⇒ `FISCAL_CLASSIFICATION_INVALID` (`details.issues`); `ambiguous` ⇒ `FISCAL_CLASSIFICATION_AMBIGUOUS`; `unavailable` ⇒ segue com `catalogValidated: false`. Registrar `justification` (`"explicit request override"`).
3. **Perfil de serviço da empresa**: se `requestedProfileId` ⇒ busca por id (deve existir, ser da empresa, vigente na competência e `regimeApplicability` vazia ou contendo o regime; senão `FISCAL_CLASSIFICATION_INVALID`). Senão, entre `serviceProfiles` (por `serviceCode` + data): 0 ⇒ passo 4; 1 ⇒ usa; >1 ⇒ `FISCAL_CLASSIFICATION_AMBIGUOUS` (`details: { candidates: [ids] }`) — nunca a primeira. Perfil `unreviewed` em `live` ⇒ `FISCAL_REVIEW_REQUIRED`; `rejected` ⇒ `FISCAL_REVIEW_REQUIRED`.
4. **Catálogo oficial** inequívoco: no Spec 2 o catálogo só valida `cTribNac`; não há derivação de NBS/CST/cClassTrib ⇒ classificação com `source: 'official_catalog'`, `nbsCode/cst/classCode/operationIndicator: null`, `catalogValidated: false`, `operationNature: 'SERVICE'`, `iss.taxation: null`, `withholding.policy: 'UNKNOWN'`, `justification: 'service code found in official catalog; no company classification configured'`. (Isso é uma classificação **parcial** válida: as etapas seguintes decidem se faltam campos para a aplicabilidade; para regimes MEI/Simples-2026 ela basta.)
5. Quando a etapa seguinte exigir IBS/CBS e faltar `nbsCode`/`cst`/`classCode`/`operationIndicator`, quem falha é a `TaxApplicabilityResolver` com `FISCAL_CLASSIFICATION_REQUIRED` e `details.missingFields` (Task 11), não o classificador.

- [ ] **Step 1: Write the failing tests** (puros, catálogo fake `fakeCatalog({ known: ['060101','010601'], validation })`; classificação sintética de `test/fixtures/synthetic-fiscal-codes.ts` — crie o arquivo com `SYNTHETIC_NBS = '900000001'`, `SYNTHETIC_CST = '900'`, `SYNTHETIC_CLASS = '900001'`, `SYNTHETIC_INDOP = '900001'` e o comentário "SYNTHETIC — format-valid placeholders for pure unit tests only"):

```ts
it('rejects a service code absent from the official catalog', ...);          // FISCAL_CLASSIFICATION_INVALID
it('explicit override wins and is flagged request_override', ...);
it('override merges only missing fields from the approved company profile', ...);
it('company profile classification is used when no override is sent', ...);
it('requested serviceProfileId must belong to the company and be effective on the competence date', ...);
it('two effective profiles for the same code are ambiguous (never picks the first)', ...);  // FISCAL_CLASSIFICATION_AMBIGUOUS
it('profile whose regimeApplicability excludes the regime is not used', ...);
it('falls back to a partial official-catalog classification', ...);
it('catalog-invalid override fails with the catalog issues', ...);
it('live + unreviewed service profile requires review', ...);
it('carries ISS settings and withholding policy from the profile', ...);
it('carries operationNature from the profile (GOODS)', ...);
```
e `service-tax-classifier.step.spec.ts`: pré-condição sem `companyProfile` ⇒ `FISCAL_INTERNAL_ERROR`; caminho feliz atualiza `context.classification` e adiciona warning `CLASSIFICATION_NOT_CATALOG_VALIDATED` quando `catalogValidated` é falso.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** `classifyService` seguindo as regras e o step (injeta `IServiceProfileReader` e `IFiscalCatalog`; carrega perfis: por id quando informado, senão `findEffectiveByCode(company, tenant, service.code, competenceDate)`).

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice && yarn typecheck && yarn typecheck:tests` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add service tax classifier step"`

---

## Task 11: Etapa TaxApplicabilityResolver

**Files:**
- Create: `src/modules/invoice/application/fiscal/steps/tax-applicability.step.ts`
- Test: `tax-applicability.step.spec.ts`

**Interfaces:**
- Consumes: `TaxStrategyResolver`, `TaxTransitionPolicy` (Tasks 7–8), `context.companyProfile`/`classification` (Tasks 9–10).
- Produces: `TaxApplicabilityStep` (`name = 'TaxApplicabilityResolver'`, `required = true`) que preenche `context.applicability`.

Comportamento (após `strategy.plan` ok):
- Anexa `strategy: strategy.name`, `rulesVersion: policy.rulesVersion`, `legalReferences` (união das `legalReference` das regras usadas: `ibscbs.test-phase` quando a data cai nela; `nfse.ibscbs-information`; `simples.ibscbs-effective` quando consultada).
- **Bloqueios**, em ordem: `customerRequired && invoice.customer === null` ⇒ `FISCAL_VALIDATION_FAILED` (`VALIDATION`, `details.fields: ['customer']`); qualquer obrigação `UNSUPPORTED` ⇒ `TAX_CALCULATION_UNSUPPORTED` (`UNSUPPORTED`, `details: { tax, reason }`; para `specialTreatment` ⇒ `FISCAL_REVIEW_REQUIRED`); qualquer `MISSING_CONFIGURATION` ⇒ `TAX_RATE_NOT_FOUND` quando o campo faltante é `service.iss.rate`, senão `TAX_APPLICABILITY_UNKNOWN` (`CONFIGURATION`, `details.missingFields`).
- **IBS/CBS `REQUIRED`**: exige classificação completa (`nbsCode`, `cst`, `classCode`, `operationIndicator`) **e** `catalogValidated`; faltando ⇒ `FISCAL_CLASSIFICATION_REQUIRED` (`CLASSIFICATION`, `details.missingFields: ['service.fiscal.nbsCode', …]` somente os faltantes; se `catalogValidated` falso com tudo presente ⇒ `FISCAL_CLASSIFICATION_INVALID` com `details.reason: 'catalog_validation_unavailable'`).
- Decisão D1: com IBS/CBS `REQUIRED` e `RtcCalculatorPort` **não configurado** a falha vem da Task 13 (`TAX_CALCULATION_UNAVAILABLE`, não retryable) — esta etapa não conhece o RTC. A tolerância da Sefin só é consultada na Task 13.

- [ ] **Step 1: Write the failing tests**: MEI 2026 ok sem tomador; regime regular sem tomador ⇒ `FISCAL_VALIDATION_FAILED` com `fields: ['customer']`; MEI + 2027 ⇒ `TAX_CALCULATION_UNSUPPORTED`; regular com IBS/CBS requerido e classificação sem NBS ⇒ `FISCAL_CLASSIFICATION_REQUIRED` listando só os campos faltantes (`SYNTHETIC_*` para os presentes); regular + ISS sem alíquota ⇒ `TAX_RATE_NOT_FOUND`; cliente PJ + política `UNKNOWN` ⇒ `TAX_APPLICABILITY_UNKNOWN`; `GOODS` ⇒ `OPERATION_DOCUMENT_UNSUPPORTED` (propagado da estratégia); `PARTNER_SALON` ⇒ `FISCAL_REVIEW_REQUIRED`; pré-condições ausentes (`companyProfile` ou `classification`) ⇒ `FISCAL_INTERNAL_ERROR`; **`UNSUPPORTED` nunca vira `NOT_APPLICABLE`** (assert direto: nenhum caminho devolve `applied` com `cbs: NOT_APPLICABLE` para MEI 2027); `legalReferences` e `rulesVersion` presentes.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** (injetar `TaxStrategyResolver`, `TaxTransitionPolicy`; método privado `missingClassificationFields(classification)` devolvendo os caminhos `service.fiscal.*`).

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice/application/fiscal && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add tax applicability resolver step"`

---

## Task 12: LegacyTaxCalculator (ISS e retenções)

**Files:**
- Create: `src/modules/invoice/domain/fiscal/legacy/iss-tax.resolver.ts`
- Create: `src/modules/invoice/domain/fiscal/legacy/withholding.resolver.ts`
- Create: `src/modules/invoice/application/fiscal/steps/legacy-tax-calculator.step.ts`
- Test: `iss-tax.resolver.spec.ts`, `withholding.resolver.spec.ts`, `legacy-tax-calculator.step.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function resolveIss(input: { gross: Decimal; discount: Decimal; ratePercent: Decimal; withheld: boolean }): { iss: TaxAmount; issResponsible: 'PROVIDER' | 'CUSTOMER' };
  export function resolveWithholdings(input: { base: Decimal; rates: WithholdingRates }): WithholdingAmount[];
  export function netReceivable(input: { gross: Decimal; discount: Decimal; withholdings: readonly WithholdingAmount[]; issWithheldAmount: Decimal | null }): Decimal;
  export class LegacyTaxCalculatorStep implements FiscalStep { name = 'LegacyTaxCalculator'; required = false }
  ```

Regras:
- Base ISS = `gross - discount` (regra `deductUnconditionalDiscount`; desconto incondicional não integra a base — registre no `calculationMemory`/warning da referência LC 116 art. 7º; **se `discount > gross` ⇒ `FISCAL_VALIDATION_FAILED`**, `details.fields: ['discount']`).
- `ISS = round(base × rate / 100)`; `issResponsible = 'CUSTOMER'` quando retido, senão `'PROVIDER'`.
- Retenções federais: para cada taxa configurada, `amount = round(base × rate / 100)` com `base = gross - discount`; `tax` ∈ `IRRF|PIS|COFINS|CSLL|INSS`.
- `netReceivable = gross − discount − Σ withholdings (federais) − (issWithheld ? ISS : 0)`; **IBS/CBS nunca são subtraídos**. Resultado nunca negativo (`< 0` ⇒ `FISCAL_VALIDATION_FAILED`).
- Step: `skipped` (`required = false`) com razão quando `iss`, `issWithheld` e `federalWithholding` são `NOT_APPLICABLE`; pré-condições (`applicability`, `classification`) ausentes ⇒ erro interno; alíquota ISS lida de `classification.iss.rate` (se `REQUIRED` e nula ⇒ `TAX_RATE_NOT_FOUND`, defesa em profundidade).

- [ ] **Step 1: Write the failing tests**

```ts
describe('resolveIss', () => {
  it('ISS = base × rate (didactic example)', () => {
    const r = resolveIss({ gross: toDecimal('1000.00'), discount: toDecimal('0'), ratePercent: toDecimal('3'), withheld: false });
    expect(r.iss).toEqual({ base: '1000.00', rate: '3', amount: '30.00' });
    expect(r.issResponsible).toBe('PROVIDER');
  });
  it('deducts the unconditional discount from the base (R$100 off R$1000)', () => {
    const r = resolveIss({ gross: toDecimal('1000.00'), discount: toDecimal('100.00'), ratePercent: toDecimal('5'), withheld: false });
    expect(r.iss).toMatchObject({ base: '900.00', amount: '45.00' });
  });
  it.each([['0.01', '2', '0.00'], ['0.25', '2', '0.01'], ['9999999999.99', '5', '499999999.99'], ['100.05', '2.5', '2.50']])(
    'rounds half up at the cent: %s × %s%% = %s', (gross, rate, expected) =>
      expect(resolveIss({ gross: toDecimal(gross), discount: toDecimal('0'), ratePercent: toDecimal(rate), withheld: false }).iss.amount).toBe(expected));
  it('marks the customer as responsible when withheld', () =>
    expect(resolveIss({ gross: toDecimal('100'), discount: toDecimal('0'), ratePercent: toDecimal('2'), withheld: true }).issResponsible).toBe('CUSTOMER'));
});
describe('netReceivable', () => {
  it('subtracts only withheld taxes, never IBS/CBS', () => { /* gross 1000, discount 100, ISS withheld 45, IRRF 13.50 → 841.50 */ });
  it('rejects a negative net amount', ...);
});
describe('resolveWithholdings', () => {
  it('computes each configured rate and ignores unset ones', ...);
});
```
Step spec: `skipped` quando nada aplicável (MEI); ISS retido calculado e `netReceivableAmount`; `discount > gross` ⇒ `FISCAL_VALIDATION_FAILED`; sem alíquota ⇒ `TAX_RATE_NOT_FOUND`.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** (funções puras com `percentOf`/`moneyString`/`rateString`; step monta `LegacyTaxResult`).

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add ISS and withholding calculation"`

---

## Task 13: Port RTC, fake, não configurado e etapa RtcTaxCalculator

**Files:**
- Create: `src/modules/invoice/domain/fiscal/rtc/rtc-calculator.port.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/fake-rtc-calculator.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/unconfigured-rtc-calculator.ts`
- Create: `src/modules/invoice/application/fiscal/steps/rtc-tax-calculator.step.ts`
- Test: `rtc-tax-calculator.step.spec.ts`, `fake-rtc-calculator.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RtcCalculationInput {
    competenceDate: string; grossAmount: DecimalString; discountAmount: DecimalString;
    serviceCode: string; nbsCode: string; cst: string; classCode: string; operationIndicator: string;
    providerTaxId: string; providerMunicipalityCode: string; incidenceMunicipalityCode: string;
    customer: { kind: 'CPF' | 'CNPJ'; taxId: string; municipalityCode: string | null } | null;
    regime: TaxRegimeKind;
  }
  export abstract class RtcCalculatorPort {
    health(): Promise<Result<{ available: true }, FiscalError>>;
    version(): Promise<Result<string, FiscalError>>;
    calculate(input: RtcCalculationInput): Promise<Result<RtcTaxResult, FiscalError>>;
  }
  export class FakeRtcCalculator extends RtcCalculatorPort { constructor(options?: { version?: string; handler?: (input: RtcCalculationInput) => Result<RtcTaxResult, FiscalError> }) }
  export class UnconfiguredRtcCalculator extends RtcCalculatorPort  // calculate → TAX_CALCULATION_UNAVAILABLE, details.reason 'adapter_not_configured', retryable false
  export class RtcTaxCalculatorStep implements FiscalStep { name = 'RtcTaxCalculator'; required = false; constructor(rtc: RtcCalculatorPort, policy: TaxTransitionPolicy, mode: 'block' | 'warn') }
  ```
- `FakeRtcCalculator` default: aplica a fase de teste de 2026 (CBS `0.9`, IBS `0.1`, componentes ibsState = 0, ibsCity = ibsTotal — **é um fake de teste**, nunca usado em produção) sobre `gross − discount`.

Comportamento da etapa:
- `skipped` quando `applicability.cbs` e `applicability.ibs` são `NOT_APPLICABLE` (razão copiada da aplicabilidade).
- Pré-condições: `applicability`, `classification` completa (se `REQUIRED` os quatro códigos já foram garantidos na Task 11) e `companyProfile`; senão `FISCAL_INTERNAL_ERROR`.
- Monta `RtcCalculationInput`; chama `rtc.calculate`. Erro `TAX_CALCULATION_UNAVAILABLE` **não retryable com `details.reason === 'adapter_not_configured'`**: se `mode === 'warn'` **e** `policy.ibsCbsInformation(...).toleratedBySefin` ⇒ `applied` com warning `IBS_CBS_NOT_DECLARED_TOLERATED` e `context.rtcTaxes` ausente (D1 `warn`); caso contrário propaga o erro. Qualquer outro erro propaga como veio.
- **Validação da resposta do motor** antes de aceitar: `ibsTotal.amount === ibsState.amount + ibsCity.amount` (quando os três existem); `amount` ≥ 0; `base` ≤ `gross`; senão `TAX_CALCULATION_UNAVAILABLE`? Não: `CALCULATION` / código `FISCAL_VALIDATION_FAILED` com `details.reason: 'rtc_inconsistent_result'` (não retryable).

- [ ] **Step 1: Write the failing tests**

```ts
it('skips when CBS and IBS are not applicable, keeping the reason', ...);
it('calls the calculator with the classification and incidence data', ...);
it('stores the typed RTC result in the context (R$1000: CBS 9.00, IBS 1.00 with the fake)', ...);
it('propagates a retryable integration error unchanged', ...);                         // TAX_CALCULATION_UNAVAILABLE retryable true
it('unconfigured adapter blocks in block mode', ...);                                   // not retryable
it('unconfigured adapter in warn mode inside the Sefin tolerance window emits a warning and continues', ...); // 2026-12-10
it('warn mode does not tolerate after 2026-12-31', ...);                                // competence 2027-01-05 → error
it('rejects an inconsistent engine result (IBS parts do not sum to the total)', ...);
it('rejects a negative amount from the engine', ...);
it('does not call the calculator twice for one execution', ...);
```
`fake-rtc-calculator.spec.ts`: aplica 0,9%/0,1% sobre `1000` ⇒ `9.00`/`1.00`; com `discount 100` ⇒ base `900.00`; handler customizado é respeitado.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** (port em `rtc-calculator.port.ts`; fake e não configurado em `infra/fiscal/rtc`; step conforme o comportamento; checagens de consistência em função pura `assertRtcResultConsistent(result, gross)` no mesmo arquivo do step e testada diretamente).

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add RTC calculator port, fakes and RTC step"`

---

## Task 14: FiscalValidator, FiscalCalculationResult e ResultBuilder

**Files:**
- Create: `src/modules/invoice/domain/fiscal/validation/fiscal-validator.ts`
- Create: `src/modules/invoice/domain/fiscal/fiscal-calculation-result.ts`
- Create: `src/modules/invoice/domain/fiscal/result-builder.ts`
- Create: `src/modules/invoice/application/fiscal/steps/fiscal-validator.step.ts`
- Test: `fiscal-validator.spec.ts`, `result-builder.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FiscalCalculationResult {
    readonly operationId: string;               // invoiceId
    readonly companyId: string;
    readonly competenceDate: string;
    readonly taxRegime: TaxRegimeKind;
    readonly profileId: string;
    readonly classification: ServiceTaxClassification;
    readonly taxableAmounts: { gross: DecimalString; discount: DecimalString; iss?: DecimalString; ibsCbs?: DecimalString };
    readonly taxes: { iss?: TaxAmount; cbs?: TaxAmount; ibsState?: TaxAmount; ibsCity?: TaxAmount; ibsTotal?: TaxAmount };
    readonly withholdings: readonly WithholdingAmount[];
    readonly netReceivableAmount: DecimalString;
    readonly applicability: TaxApplicability;
    readonly collectionWaived: boolean;
    readonly calculationSource: 'legacy' | 'rtc' | 'legacy+rtc' | 'none';
    readonly calculatorVersion: string | null;
    readonly catalogVersions: Record<string, string>;
    readonly rulesVersion: string;
    readonly legalReferences: readonly string[];
    readonly warnings: readonly FiscalWarning[];
    readonly requiresReview: boolean;
    readonly trace: readonly StepTrace[];
    readonly calculationMemory: readonly unknown[];
  }
  export function validateFiscalContext(context: FiscalContext): { errors: FiscalIssueLike[]; warnings: FiscalWarning[] };
  export function buildFiscalCalculationResult(context: FiscalContext): Result<FiscalCalculationResult, FiscalError>;
  export class FiscalValidatorStep implements FiscalStep { name = 'FiscalValidator'; required = true }
  ```
  `FiscalIssueLike = { field: string; code: string; message: string }`.

Validações (cada uma com teste): perfil e classificação presentes; `classification.serviceCode === invoice.service.code`; se IBS/CBS `REQUIRED`, `rtcTaxes` presente **ou** warning de tolerância; se `iss` `REQUIRED`, `legacyTaxes.iss` presente e `base == gross − discount`; regime `MEI`/`SIMPLES` não pode ter `legacyTaxes.iss`/`rtcTaxes` (invariante: nenhum cálculo indevido); `classCode`/`cst` presentes ⇒ ambos não vazios e `operationIndicator` presente (consistência entre campos da classificação, e **coerência com o catálogo** quando `catalogValidated`); soma de retenções ≤ `gross − discount`; todos os valores são strings decimais válidas com ≤ 2 casas (monetários) ; competência no formato `YYYY-MM-DD`. Erros ⇒ `FISCAL_VALIDATION_FAILED` com `details.issues`; warnings não bloqueiam. `calculationSource`: `legacy` se só `legacyTaxes`; `rtc` se só `rtcTaxes`; `legacy+rtc`; `none`. `requiresReview = warnings.some(code startsWith 'REVIEW')` ou aplicabilidade `specialTreatment` não `NOT_APPLICABLE` (nunca chega aqui — bloqueada antes) — mantenha o campo por contrato.

- [ ] **Step 1: Write the failing tests** — contexto válido de cada regime produz resultado completo (MEI 2026: `taxes {}`, `calculationSource 'none'`; regular 2026 com fake RTC: `cbs.amount '9.00'`, `ibsTotal.amount '1.00'`, `calculationSource 'legacy+rtc'`, `collectionWaived true`); invariantes violadas (MEI com ISS calculado; IBS/CBS requerido sem `rtcTaxes`; base ISS ≠ gross−discount; retenções > líquido) ⇒ `FISCAL_VALIDATION_FAILED` com `issues` por campo; o resultado é **imutável** (`Object.isFrozen` nos níveis superior e em `taxes`); `buildFiscalCalculationResult` é determinístico (mesmo contexto ⇒ `toEqual` idêntico, `calculatedAt` **não** faz parte do resultado).

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** (congelar com um helper `deepFreeze` local em `result-builder.ts`).

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add fiscal validator and immutable calculation result"`

---

## Task 15: DTO, normalização e tomador opcional ponta a ponta

**Files:**
- Modify: `src/modules/invoice/http/invoice.dto.ts` (`ServiceFiscalDto`, `ServiceDto.fiscal/serviceProfileId`, `CustomerDto` opcional, `CustomerAddressDto.municipalityCode`, `CreateInvoiceDto.discount`)
- Modify: `src/modules/invoice/domain/invoice-domain.service.ts` (`normalizeAndValidate`: modo engine)
- Modify: `src/modules/invoice/domain/invoice.ts`, `infra/invoice.mapper.ts`, `infra/invoice.orm-entity.ts` (`customerSnapshot` nulo; `serviceSnapshot.fiscal/serviceProfileId/discount`)
- Create: `src/infra/database/migrations/1791800000000-InvoiceCustomerNullable.ts`
- Modify (leitores de `customerSnapshot`): `src/modules/invoice/application/nfse-workflow.service.ts`, `jobs/nfse-doc-prep.processor.ts`, `jobs/nfse-email.processor.ts`, `http/invoice-response.dto.ts`, `infra/external/nfse/nfse-fiscal-provider.ts` (`tomador?`), `infra/external/nfse/issue-params.ts`
- Test: `invoice-domain.service.spec.ts`, `nfse-workflow.service.spec.ts`, processors specs, DTO spec

**Interfaces:**
- Produces:
  ```ts
  // invoice.dto.ts
  export class ServiceFiscalDto { @IsOptional() @IsString() @Matches(/^\d{9}$/) nbsCode?: string; … cst @Matches(/^\d{3}$/); classCode @Matches(/^\d{6}$/); operationIndicator @Matches(/^\d{6}$/) }
  ServiceDto.fiscal?: ServiceFiscalDto; ServiceDto.serviceProfileId?: string (@IsUUID)
  CustomerAddressDto.municipalityCode?: string (@Matches(/^\d{7}$/))
  CreateInvoiceDto.customer?: CustomerDto (agora opcional); CreateInvoiceDto.discount?: number (@IsOptional() @IsNumber())
  // invoice-domain.service.ts
  normalizeAndValidate(dto, environment, defaults, mode?: { engine: boolean }): NormalizedInvoiceInput   // NormalizedInvoiceInput.customer: … | null; .discount: number; .service.fiscal?/serviceProfileId?
  // Invoice domain
  CustomerSnapshot | null in InvoiceProps.customerSnapshot; ServiceSnapshot gains fiscal?: ServiceFiscalInput; serviceProfileId?: string; InvoiceProps.discount?: number
  ```
  > Formatos de NBS/CST/cClassTrib/cIndOp acima são validações **estruturais** (comprimentos do leiaute); **confira** com os XSD RTC v1.01 do `open-nfse` (`node_modules/open-nfse/dist/nfse/_rtc-schemas.generated.js`) antes de fixar os `@Matches`, ajustando se divergirem.

Regras de `normalizeAndValidate` (`mode.engine === true`):
- `customer` ausente ⇒ `customer: null` (não fabrica `'Consumidor'`/`'SIM'`/`'SS'`); presente ⇒ validação atual (nome, taxId CPF/CNPJ alfanumérico, endereço).
- `discount`: ≥ 0, ≤ 2 casas, ≤ `amount` (`FiscalValidationError` campo `discount`, códigos `out_of_range` / `invalid_decimal_places`). Conversão para `Decimal` por string, sem `Math.round`.
- `service.fiscal` repassado sem interpretar; `serviceProfileId` repassado.
- Com `engine === false` (flag desligada): comportamento atual **idêntico** (customer obrigatório, defaults fabricados) — os testes existentes não mudam.

- [ ] **Step 1: Write the failing tests**: (domínio) com `engine: true` e sem customer ⇒ `customer === null`; com customer completo ⇒ mesmos valores de hoje; `discount` 100 em amount 1000 ok; `discount` 1000.01 ⇒ `out_of_range`; `discount` com 3 casas ⇒ `invalid_decimal_places`; `engine: false` + sem customer ⇒ ainda exige `customer.taxId` (regressão); CNPJ alfanumérico `12ABC34501DE35`... (use um CNPJ alfanumérico **válido** calculado pelo próprio `isValidCnpj`: gere-o no teste com um helper que calcula os DVs e valide com `isValidCnpj`); (workflow) `payload()` com `customerSnapshot === null` não lança e não envia `tomador`; (email processor) invoice sem cliente ⇒ não tenta enviar e-mail e conclui sem erro (marca `skipped`); (doc-prep) gera PDF sem tomador sem lançar; (response DTO) serializa `customer: null`.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Migration** `1791800000000-InvoiceCustomerNullable.ts`: `ALTER TABLE nfse_invoices ALTER COLUMN customer_snapshot DROP NOT NULL` (+ `down` com `SET NOT NULL` precedido de `UPDATE … SET customer_snapshot = '{}'::jsonb WHERE customer_snapshot IS NULL`).

- [ ] **Step 4: Implement** conforme Interfaces; nos leitores: `const customer = snapshot.customerSnapshot; if (!customer) …` com o comportamento especificado nos testes. `nfse-fiscal-provider.ts`: `tomador?: …` opcional e `issue-params.ts`: `...(payload.tomador ? { tomador: payload.tomador } : {})`. **Verifique no `open-nfse`** (`EmitirParams.tomador` em `node_modules/open-nfse/dist/**/*.d.ts`) que `tomador` é opcional; se não for, o spec 2 só habilita tomador ausente para a engine ligada e o plano 3 trata a DPS sem tomador — nesse caso mantenha o bloqueio `FISCAL_VALIDATION_FAILED` para `customer: null` quando o `open-nfse` exigir e registre a limitação em `docs/fiscal/limitations.md`.

- [ ] **Step 5: Run to verify they pass** — `yarn jest src && yarn typecheck && yarn typecheck:tests` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(invoice): optional customer, discount and fiscal input in the DTO"`

---

## Task 16: Snapshot fiscal imutável

**Files:**
- Modify: `rls-tables.ts` (+ `'invoice_fiscal_snapshots'`), `tenant-rls.postgres.integration.spec.ts` (20)
- Create: `src/infra/database/migrations/1791810000000-CreateInvoiceFiscalSnapshots.ts`
- Create: `src/modules/invoice/domain/fiscal/fiscal-snapshot.repository.ts`
- Create: `src/modules/invoice/infra/fiscal/invoice-fiscal-snapshot.orm-entity.ts`, `typeorm-fiscal-snapshot.repository.ts`
- Test: integração do repositório

**Interfaces:**
- Produces:
  ```ts
  export interface FiscalSnapshot { id: string; invoiceId: string; tenantId: string; companyId: string; taxRegime: TaxRegimeKind; profileId: string; serviceProfileId: string | null; specialTaxRegime: string | null; result: FiscalCalculationResult; calculatedAt: Date }
  export abstract class IFiscalSnapshotRepository {
    insert(snapshot: Omit<FiscalSnapshot, 'id'>): Promise<boolean>;   // false when the invoice already has one (idempotent)
    findByInvoiceId(invoiceId: string, tenantId: string): Promise<FiscalSnapshot | null>;
  }
  ```
  Tabela: `id, invoice_id uuid UNIQUE REFERENCES nfse_invoices(id) ON DELETE CASCADE, tenant_id, company_id, tax_regime varchar(20), profile_id uuid, service_profile_id uuid, special_tax_regime varchar(50), result jsonb NOT NULL, rules_version varchar(20), calculator_version varchar(40), catalog_versions jsonb, calculated_at timestamptz`. Trigger `BEFORE UPDATE OR DELETE` que lança `RAISE EXCEPTION 'invoice_fiscal_snapshots is immutable'` — exceto `DELETE` disparado por `ON DELETE CASCADE` da invoice? Cascade dispara o trigger de DELETE; permita-o com `IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;` e teste isso.

- [ ] **Step 1: Write the failing integration tests**: insert grava e `findByInvoiceId` devolve `result` idêntico (round-trip JSON com strings decimais intactas); segundo insert para a mesma invoice devolve `false` e não altera; `UPDATE` direto falha com a mensagem do trigger; `DELETE` direto falha; apagar a invoice (cascade) funciona; RLS esconde de outro tenant.

- [ ] **Step 2–4:** Run (FAIL) → implementar migration (padrão das anteriores, RLS idêntica, trigger) / entity / repository (`INSERT … ON CONFLICT (invoice_id) DO NOTHING RETURNING id`) → Run (PASS: `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/invoice src/infra/database`).

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): persist immutable invoice fiscal snapshots"`

---

## Task 17: FiscalEngineService e wiring (FISCAL_STEPS)

**Files:**
- Create: `src/modules/invoice/application/fiscal/fiscal-engine.service.ts`
- Create: `src/modules/invoice/application/fiscal/fiscal-steps.provider.ts`
- Modify: `src/modules/invoice/invoice.module.ts`
- Modify: `src/modules/company/company.module.ts` (exports `CompanyFiscalProfileService`, `CompanyServiceTaxProfileService`)
- Test: `fiscal-engine.service.spec.ts` (integração em memória com repositórios fake + `FakeRtcCalculator`)

**Interfaces:**
- Consumes: todas as etapas (Tasks 9–14), `FiscalPipeline`, `OtelPipelineObserver`, `IFiscalProfileReader`, `IServiceProfileReader`, `IFiscalCatalog`, `RtcCalculatorPort`, `TaxTransitionPolicy`.
- Produces:
  ```ts
  export const FISCAL_STEPS = 'FISCAL_STEPS';
  export class FiscalEngineService {
    calculate(invoice: Invoice): Promise<Result<FiscalCalculationResult, FiscalError>>;    // builds NormalizedInvoice, runs pipeline, builds result
    toNormalizedInvoice(invoice: Invoice, company: Company): NormalizedInvoice;
  }
  ```
  Ordem fixa dos steps (provider de fábrica): `CompanyFiscalProfileStep → ServiceTaxClassifierStep → TaxApplicabilityStep → LegacyTaxCalculatorStep → RtcTaxCalculatorStep → FiscalValidatorStep`.
  Providers do módulo: `{ provide: IFiscalProfileReader, useExisting: CompanyFiscalProfileService }`, `{ provide: IServiceProfileReader, useExisting: CompanyServiceTaxProfileService }`, catálogo JSON (Task 6), `{ provide: RtcCalculatorPort, useClass: UnconfiguredRtcCalculator }`, `TaxTransitionPolicy` (com `TAX_RULES`), `TaxStrategyResolver` (três estratégias), `IFiscalSnapshotRepository`, `FiscalEngineService`. A string de modo D1 vem de `FISCAL_IBSCBS_UNAVAILABLE_MODE` (`block` padrão | `warn`) adicionada ao `env.schema.ts`/`configuration.ts` (seção `fiscal`).

- [ ] **Step 1: Write the failing tests** — `fiscal-engine.service.spec.ts` monta o pipeline real com leitores em memória e cobre os **cenários do briefing** (tabela abaixo), cada um com a expectativa exata:

| # | Cenário (regime / competência / entrada) | Resultado esperado |
|---|---|---|
| 01 | MEI, 2026-10-13, sem tomador, `060101`, R$ 50 | `ok`; `taxes {}`; `calculationSource 'none'`; trace com `LegacyTaxCalculator` e `RtcTaxCalculator` `skipped` e motivos |
| 02 | Simples, 2026-11-15, `060201`, R$ 200 | `ok`; sem IBS/CBS; sem ISS |
| 03 | Simples, 2027-02-10 | `ok:false`, `TAX_CALCULATION_UNSUPPORTED` (step `TaxApplicabilityResolver`) |
| 04 | Presumido, 2026-12-10, `010601`, CNPJ, classificação completa sintética, ISS 3%, RTC fake | `ok`; `taxes.iss.amount '30.00'`; `cbs '9.00'`; `ibsTotal '1.00'`; `collectionWaived true` |
| 05 | idem em 2027-03-10 | `ok`; `collectionWaived false` |
| 06 | redução validada (handler do fake com 60%) | `cbs '3.60'`, `ibsTotal '0.40'` |
| 07 | desconto R$ 100 em R$ 1000, ISS 5% | `taxes.iss.base '900.00'`, `amount '45.00'` |
| 08 | ISS retido (CNPJ, `withholdingDefault`) | `withholdings` contém ISS; `netReceivableAmount` = bruto − desc − ISS |
| 09 | município de incidência ≠ sede | `classification.iss.incidenceMunicipalityCode` preservado e usado no input do RTC |
| 10 | regular sem NBS | `FISCAL_CLASSIFICATION_REQUIRED` com `missingFields` |
| 14 | regular sem tomador | `FISCAL_VALIDATION_FAILED` (`fields ['customer']`) |
| 15 | RTC indisponível (fake retorna `retryable`) | `ok:false`, `retryable true`, step `RtcTaxCalculator` |
| 16 | RTC com resultado inconsistente | `FISCAL_VALIDATION_FAILED` `rtc_inconsistent_result` |
| 21 | troca de regime em 2026-06-01: notas de 2026-05-31 e 2026-06-01 | regimes diferentes no resultado |
| 24 | serviço `GOODS` | `OPERATION_DOCUMENT_UNSUPPORTED` |
| 26 | `PARTNER_SALON` | `FISCAL_REVIEW_REQUIRED` |
| 30 | nota de competência passada após atualização de regras | resultado reproduzível: mesmo `rulesVersion` e valores com as mesmas entradas |
| — | duas invoices simultâneas | resultados independentes |

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** — `FiscalEngineService.calculate` constrói `NormalizedInvoice` (dinheiro via `moneyString(toDecimal(amount))`; `competenceDate` = `YYYY-MM-DD` da invoice; `customer` a partir de `customerSnapshot` com `kind` pelo tamanho do `taxId`), cria `new FiscalPipeline(steps, new OtelPipelineObserver({...}))`, executa e, se `ok`, `buildFiscalCalculationResult(context)`. `fiscal-steps.provider.ts`:
```ts
export const fiscalStepsProvider = {
  provide: FISCAL_STEPS,
  useFactory: (...steps: FiscalStep[]) => steps,
  inject: [CompanyFiscalProfileStep, ServiceTaxClassifierStep, TaxApplicabilityStep, LegacyTaxCalculatorStep, RtcTaxCalculatorStep, FiscalValidatorStep],
};
```
Config `fiscal`: `{ engineEnabled: boolean; ibsCbsUnavailableMode: 'block' | 'warn' }`, env `FISCAL_ENGINE_ENABLED` (booleanFromEnv, padrão false) e `FISCAL_IBSCBS_UNAVAILABLE_MODE`.

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add fiscal engine service and module wiring"`

---

## Task 18: Handler `invoice.calculate_taxes`, intake com flag e emissão a partir do snapshot

**Files:**
- Create: `src/modules/invoice/application/fiscal/calculate-taxes.handler.ts`
- Modify: `src/modules/invoice/application/invoice-lifecycle.service.ts` (`submit` aceita `firstStep`)
- Modify: `src/modules/invoice/application/invoice.service.ts` (lê a flag e passa `firstStep`)
- Modify: `src/modules/invoice/domain/invoice-status.ts` (`queued: ['processing', 'rejected']`)
- Modify: `src/modules/invoice/application/nfse-workflow.service.ts` (`rejectBeforeProcessing`, payload do snapshot)
- Modify: `src/modules/webhooks-config/domain/webhook-event.ts` (sem novos tipos; reutiliza `nfse.invoice.rejected`)
- Modify: `src/worker-app.module.ts` (`CalculateTaxesHandler`)
- Test: `calculate-taxes.handler.spec.ts`, `invoice-state.spec.ts`/`invoice.spec.ts` (transição), `invoice-lifecycle.service.spec.ts`, `nfse-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `OutboxHandler`, `OutboxService`, `FiscalEngineService`, `IFiscalSnapshotRepository`, `InvoiceLifecycleService.transition`, `OutboxConfig.maxAttempts`.
- Produces:
  ```ts
  export const INVOICE_CALCULATE_TAXES = 'invoice.calculate_taxes';
  InvoiceLifecycleService.submit(invoice, event, dailyLimit, firstStep: 'emit' | 'calculate_taxes' = 'emit'): Promise<void>
  NfseWorkflowService.rejectBeforeProcessing(invoice: Invoice, code: string, message: string): Promise<void>   // public; queued → rejected + webhook nfse.invoice.rejected
  ```

Fluxo do handler (`handle(message)`):
1. Carrega a invoice (tenant do `message`); se não existe ou `status !== 'queued'` ⇒ retorna (idempotente; a mensagem é concluída).
2. Se já existe snapshot da invoice ⇒ garante a mensagem `invoice.emit` (`outbox.enqueue` com `dedupeKey emission:{id}`, idempotente) e retorna.
3. Carrega a company, `engine.calculate(invoice)`.
4. `ok` ⇒ em **uma transação** (`dataSource.transaction` + `TypeOrmTransactionContext.run`, como `lifecycle.submit`): `snapshots.insert(...)` e `outbox.enqueue({ type: INVOICE_EMIT, dedupeKey: 'emission:{id}', … })`.
5. `err` com `retryable` ⇒ se `message.attempts >= maxAttempts` ⇒ `workflow.rejectBeforeProcessing(invoice, 'TAX_CALCULATION_UNAVAILABLE', error.message)`; senão **lança** `Error(error.code)` (a outbox reentrega com backoff).
6. `err` não retryable ⇒ `workflow.rejectBeforeProcessing(invoice, error.code, error.message)` (grava `lastErrorCode`, transição `queued → rejected` com reembolso do crédito pelo `lifecycle.transition`, webhook com `errorCode`/`errorMessage`), **sem lançar**.

Flag: `InvoiceService.emit` chama `lifecycle.submit(invoice, event, dailyLimit, config.fiscal.engineEnabled ? 'calculate_taxes' : 'emit')`; com a flag ligada, `normalizeAndValidate(..., { engine: true })`. O tipo da mensagem e o `dedupeKey` (`calc:{invoiceId}`) mudam conforme `firstStep`.

`NfseWorkflowService.payload()` com snapshot: se existir snapshot para a invoice, `opSimpNac`/`regEspTrib` derivam de `snapshot.result`'s `taxRegime` e do `specialTaxRegime` do snapshot, `cTribNac` de `snapshot.result.classification.serviceCode`, e `tomador` é omitido quando `customerSnapshot === null`; sem snapshot (flag desligada) mantém o caminho da Task 4.

- [ ] **Step 1: Write the failing tests**
  - `calculate-taxes.handler.spec.ts` (engine fake, repos fake, `outbox` e `workflow` mocks): sucesso grava snapshot **e** `invoice.emit` na mesma transação (ordem asserida e rollback se a segunda falhar); invoice já `processing` ⇒ no-op; reprocessar após snapshot existente não duplica; erro não retryable ⇒ `rejectBeforeProcessing` com o código e **sem lançar**; erro retryable com `attempts < max` ⇒ lança; com `attempts >= max` ⇒ rejeita com `TAX_CALCULATION_UNAVAILABLE`; exceção inesperada do pipeline propaga (retry).
  - `invoice.spec.ts`/`invoice-state.spec.ts`: `queued → rejected` é válido; `authorized → rejected` continua inválido.
  - `invoice-lifecycle.service.spec.ts`: `firstStep: 'calculate_taxes'` grava mensagem `invoice.calculate_taxes` com `dedupeKey calc:{id}`; padrão `'emit'` inalterado.
  - `invoice.service*.spec.ts`: com a flag ligada, `submit` recebe `'calculate_taxes'`; desligada, `'emit'`.
  - `nfse-workflow.service.spec.ts`: `rejectBeforeProcessing` chama `lifecycle.transition` com evento `queued→rejected`, define `lastErrorCode`, dispara webhook `nfse.invoice.rejected` com `errorCode`; `payload()` usa o regime do snapshot (nota de competência anterior com regime antigo ⇒ `opSimpNac` do regime antigo) e omite `tomador` sem cliente.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** conforme os fluxos acima. `rejectBeforeProcessing`:
```ts
async rejectBeforeProcessing(invoice: Invoice, code: string, message: string): Promise<void> {
  invoice.setRejected(code, message);
  await this.lifecycle.transition(invoice, invoice.transitionTo('rejected', message));
  await this.emitWebhook(invoice, 'nfse.invoice.rejected', { errorCode: code, errorMessage: message });
}
```
Registre `CalculateTaxesHandler` em `WorkerAppModule.providers` (seu `onModuleInit` registra no `OutboxHandlerRegistry`); importe `OutboxModule` já presente via `OutboxRelayModule`.

- [ ] **Step 4: Run to verify they pass** — `yarn jest src && yarn typecheck && yarn typecheck:tests` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): run the fiscal engine from the outbox and emit from the snapshot"`

---

## Task 19: Integração ponta a ponta, documentação e verificação final

**Files:**
- Create: `src/modules/invoice/fiscal-engine.postgres.integration.spec.ts`
- Create: `docs/fiscal/limitations.md`
- Modify: `api/FRONTEND_API.md`, `api/llms.txt`, Swagger (DTOs com `@ApiPropertyOptional`)

- [ ] **Step 1: Integration test** (harness Postgres + relay + handler reais, `FakeRtcCalculator`, fiscal provider `NfseClientFake`/`FakeNfseProvider`): (a) barbearia MEI sem tomador, flag ligada: `POST` ⇒ outbox `invoice.calculate_taxes` ⇒ snapshot gravado ⇒ `invoice.emit` ⇒ `nfse-emission` publicado; (b) Presumido sem classificação ⇒ invoice `rejected` com `lastErrorCode FISCAL_CLASSIFICATION_REQUIRED`, crédito reembolsado, webhook enfileirado; (c) Simples 2027 ⇒ `rejected` `TAX_CALCULATION_UNSUPPORTED`; (d) reprocessar a mesma mensagem não duplica snapshot nem `invoice.emit`; (e) SCHEDULE com competência futura roda a engine só na data (relay com `now` avançado) usando o perfil vigente **na competência**; (f) flag desligada ⇒ comportamento atual (`invoice.emit` direto).

- [ ] **Step 2: Documentação.** `docs/fiscal/limitations.md` lista, sem eufemismo: cenários **não homologados** (nenhum validado contra a Calculadora oficial nem a Produção Restrita nesta etapa), IBS/CBS bloqueados enquanto o RTC real não existe (modo `block`), Simples/MEI de 2027 `UNSUPPORTED`, FIXED ISS, salão-parceiro, mercadorias, lista de categorias específicas do Ato Conjunto vazia, NBS/CST/cClassTrib/cIndOp sem catálogo, DPS sem grupos IBS/CBS (Spec 3). `FRONTEND_API.md`/`llms.txt`: `service.fiscal`, `serviceProfileId`, `customer` opcional, `discount`, `municipalityCode` no endereço, endpoints de perfil fiscal e códigos de erro fiscais em `lastErrorCode` e nos webhooks.

- [ ] **Step 3: Full verification**
```bash
yarn lint:check
yarn typecheck && yarn typecheck:tests
yarn test --runInBand
MIGRATION_TEST_DATABASE_URL=postgres://…_test yarn jest postgres.integration
yarn test:fiscal:integration
yarn build && node scripts/verify-build-artifacts.mjs
```
Expected: tudo verde. Reporte qualquer falha pré-existente separadamente.

- [ ] **Step 4: Commit** — `git commit -m "test(fiscal): end-to-end engine integration and docs"`
