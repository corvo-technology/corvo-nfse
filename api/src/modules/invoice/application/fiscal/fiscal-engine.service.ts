import { Inject, Injectable } from '@nestjs/common';
import type { Company } from '@/modules/company/domain/company';
import type { FiscalCalculationResult } from '@/modules/invoice/domain/fiscal/fiscal-calculation-result';
import { initialFiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { FiscalPipeline } from '@/modules/invoice/domain/fiscal/fiscal-pipeline';
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
    const normalized = this.toNormalizedInvoice(invoice, company);
    const pipeline = new FiscalPipeline(
      this.steps,
      new OtelPipelineObserver({
        invoiceId: normalized.invoiceId,
        companyId: normalized.company.id,
      }),
    );
    const outcome = await pipeline.execute(initialFiscalContext(normalized));
    if (!outcome.ok) return outcome;
    return buildFiscalCalculationResult(outcome.value);
  }

  toNormalizedInvoice(invoice: Invoice, company: Company): NormalizedInvoice {
    const snapshot = invoice.toSnapshot();
    const customerTaxId = snapshot.customerSnapshot?.taxId;
    const customer: FiscalCustomer | null =
      customerTaxId === undefined || customerTaxId === ''
        ? null
        : {
            kind: customerTaxId.length === 11 ? 'CPF' : 'CNPJ',
            taxId: customerTaxId,
            municipalityCode:
              snapshot.customerSnapshot?.address?.municipalityCode ?? null,
          };

    return {
      invoiceId: snapshot.id,
      tenantId: snapshot.tenantId,
      environment: snapshot.environment ?? 'test',
      company: {
        id: snapshot.companyId,
        taxId: company.taxId,
        municipalityCode: company.municipalityCode ?? '',
        municipalRegistration: company.municipalReg ?? null,
      },
      competenceDate: snapshot.competenceDate.toISOString().slice(0, 10),
      grossAmount: moneyString(toDecimal(snapshot.amount)),
      discountAmount: moneyString(toDecimal(snapshot.discount ?? 0)),
      service: {
        code: snapshot.serviceSnapshot.code,
        municipalityCode: snapshot.serviceSnapshot.municipalityCode,
        description: snapshot.serviceSnapshot.description,
        fiscal: snapshot.serviceSnapshot.fiscal ?? null,
        serviceProfileId: snapshot.serviceSnapshot.serviceProfileId ?? null,
      },
      customer,
    };
  }
}
