import { Inject, Injectable } from '@nestjs/common';
import type { Company } from '@/modules/company/domain/company';
import type { FiscalCalculationResult } from '@/modules/invoice/domain/fiscal/fiscal-calculation-result';
import { initialFiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { FiscalPipeline } from '@/modules/invoice/domain/fiscal/fiscal-pipeline';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NormalizedInvoiceInput } from '../../domain/invoice-domain.service';
import { moneyString, toDecimal } from '@/modules/invoice/domain/fiscal/money';
import type {
  FiscalCustomer,
  NormalizedInvoice,
} from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { Result } from '@/modules/invoice/domain/fiscal/result';
import { buildFiscalCalculationResult } from '@/modules/invoice/domain/fiscal/result-builder';
import type { FiscalStep } from '@/modules/invoice/domain/fiscal/fiscal-step';
import type { Invoice } from '@/modules/invoice/domain/invoice';
import { OtelPipelineObserver } from './pipeline-observer';
import { FISCAL_STEPS } from './fiscal-steps.provider';

/**
 * Entry point of the fiscal engine. Builds the NormalizedInvoice out of the
 * invoice aggregate and its company, runs the fixed fail-fast pipeline and
 * turns the resulting context into the immutable FiscalCalculationResult that
 * the snapshot handler persists. Every money value crosses the boundary as
 * DecimalString — no float ever reaches the engine.
 */
@Injectable()
export class FiscalEngineService {
  constructor(
    @Inject(FISCAL_STEPS) private readonly steps: readonly FiscalStep[],
  ) {}

  async calculate(
    invoice: Invoice,
    company: Company,
  ): Promise<Result<FiscalCalculationResult, FiscalError>> {
    return this.calculateNormalized(this.toNormalizedInvoice(invoice, company));
  }

  async calculateNormalized(
    normalized: NormalizedInvoice,
  ): Promise<Result<FiscalCalculationResult, FiscalError>> {
    const outcome = await this.pipeline(normalized).execute(
      initialFiscalContext(normalized),
    );
    if (!outcome.ok) return outcome;
    return buildFiscalCalculationResult(outcome.value);
  }

  async calculatePartial(normalized: NormalizedInvoice) {
    const partial = await this.pipeline(normalized).executeWithPartial(
      initialFiscalContext(normalized),
    );
    if (partial.error !== null) return { ...partial, result: null };
    const result = buildFiscalCalculationResult(partial.context);
    return result.ok
      ? { ...partial, result: result.value }
      : { ...partial, error: result.error, result: null };
  }

  private pipeline(normalized: NormalizedInvoice): FiscalPipeline {
    return new FiscalPipeline(
      this.steps,
      new OtelPipelineObserver({
        invoiceId: normalized.invoiceId,
        companyId: normalized.company.id,
      }),
    );
  }

  toNormalizedInvoice(invoice: Invoice, company: Company): NormalizedInvoice {
    const snapshot = invoice.toSnapshot();
    return toNormalizedInvoice(
      {
        companyId: snapshot.companyId,
        customer: snapshot.customerSnapshot ?? null,
        service: snapshot.serviceSnapshot,
        amount: snapshot.amount,
        discount: snapshot.discount,
        competenceDate: snapshot.competenceDate,
      },
      company,
      snapshot.tenantId,
      snapshot.environment ?? 'test',
      snapshot.id,
    );
  }
}

/** Pure mapping shared by persisted emission and in-memory pre-emission calculation. */
export function toNormalizedInvoice(
  input: Pick<
    NormalizedInvoiceInput,
    'companyId' | 'service' | 'amount' | 'discount' | 'competenceDate'
  > & {
    customer: {
      taxId?: string;
      address?: { municipalityCode?: string };
    } | null;
  },
  company: Company,
  tenantId: string,
  environment: ExecutionEnvironment,
  invoiceId: string,
): NormalizedInvoice {
  const taxId = input.customer?.taxId;
  const customer: FiscalCustomer | null =
    taxId === undefined || taxId === ''
      ? null
      : {
          kind: taxId.length === 11 ? 'CPF' : 'CNPJ',
          taxId,
          municipalityCode: input.customer?.address?.municipalityCode ?? null,
        };
  return {
    invoiceId,
    tenantId,
    environment,
    company: {
      id: input.companyId,
      taxId: company.taxId,
      municipalityCode: company.municipalityCode ?? '',
      municipalRegistration: company.municipalReg ?? null,
    },
    competenceDate: input.competenceDate.toISOString().slice(0, 10),
    grossAmount: moneyString(toDecimal(input.amount)),
    discountAmount: moneyString(toDecimal(input.discount ?? 0)),
    service: {
      code: input.service.code,
      municipalityCode: input.service.municipalityCode,
      description: input.service.description ?? null,
      fiscal: input.service.fiscal ?? null,
      serviceProfileId: input.service.serviceProfileId ?? null,
    },
    customer,
  };
}
