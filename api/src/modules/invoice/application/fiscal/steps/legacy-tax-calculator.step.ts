import { Injectable } from '@nestjs/common';
import type { Obligation } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { Decimal } from '@/modules/invoice/domain/fiscal/money';
import { moneyString, toDecimal } from '@/modules/invoice/domain/fiscal/money';
import type {
  LegacyTaxResult,
  WithholdingAmount,
} from '@/modules/invoice/domain/fiscal/legacy/legacy-tax-result';
import { resolveIss } from '@/modules/invoice/domain/fiscal/legacy/iss-tax.resolver';
import {
  netReceivable,
  resolveWithholdings,
} from '@/modules/invoice/domain/fiscal/legacy/withholding.resolver';
import type {
  FiscalStep,
  StepOutcome,
} from '@/modules/invoice/domain/fiscal/fiscal-step';
import type { TaxAmount } from '@/modules/invoice/domain/fiscal/tax-amount';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';

const isNotApplicable = (
  obligation: Obligation,
): obligation is Extract<Obligation, { status: 'NOT_APPLICABLE' }> =>
  obligation.status === 'NOT_APPLICABLE';

@Injectable()
export class LegacyTaxCalculatorStep implements FiscalStep {
  readonly name = 'LegacyTaxCalculator';
  readonly required = false;

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(
    context: Readonly<FiscalContext>,
  ): Promise<Result<StepOutcome, FiscalError>> {
    const { applicability, classification } = context;
    if (applicability === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message:
            'LegacyTaxCalculator requires the tax applicability produced by the previous step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'applicability_missing' },
        }),
      );
    }
    if (classification === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message:
            'LegacyTaxCalculator requires the service tax classification produced by the previous step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'classification_missing' },
        }),
      );
    }

    if (
      isNotApplicable(applicability.iss) &&
      isNotApplicable(applicability.issWithheld) &&
      isNotApplicable(applicability.federalWithholding)
    ) {
      return ok({
        status: 'skipped',
        context,
        reason: applicability.iss.reason,
      });
    }

    const gross = toDecimal(context.invoice.grossAmount);
    const discount = toDecimal(context.invoice.discountAmount);
    const deduction = toDecimal(context.invoice.deductionAmount ?? '0');
    if (discount.greaterThan(gross)) {
      return err(
        fiscalError({
          code: 'FISCAL_VALIDATION_FAILED',
          message: 'Discount is greater than the gross amount',
          category: 'VALIDATION',
          step: this.name,
          details: { fields: ['discount'] },
        }),
      );
    }
    if (
      deduction.greaterThanOrEqualTo(gross.minus(discount)) &&
      deduction.gt(0)
    ) {
      return err(
        fiscalError({
          code: 'FISCAL_VALIDATION_FAILED',
          message:
            'Deduction must be less than the gross amount minus the discount',
          category: 'VALIDATION',
          step: this.name,
          details: { fields: ['deduction'] },
        }),
      );
    }

    const issWithheld = applicability.issWithheld.status === 'REQUIRED';
    let iss: TaxAmount | null = null;
    let issWithheldAmount: Decimal | null = null;
    if (applicability.iss.status === 'REQUIRED') {
      const rate = classification.iss.rate;
      if (rate === null) {
        return err(
          fiscalError({
            code: 'TAX_RATE_NOT_FOUND',
            message: 'ISS tax rate is required but not configured',
            category: 'CONFIGURATION',
            step: this.name,
            details: { tax: 'ISS' },
          }),
        );
      }
      const resolved = resolveIss({
        gross,
        discount,
        deduction,
        ratePercent: toDecimal(rate),
        withheld: issWithheld,
      });
      iss = resolved.iss;
      if (resolved.issResponsible === 'CUSTOMER') {
        issWithheldAmount = toDecimal(resolved.iss.amount);
      }
    }

    const federal =
      applicability.federalWithholding.status === 'REQUIRED'
        ? resolveWithholdings({
            base: gross.minus(discount),
            rates: classification.withholding.rates,
          })
        : [];

    const withholdings: WithholdingAmount[] =
      iss !== null && issWithheldAmount !== null
        ? [
            {
              tax: 'ISS',
              base: iss.base,
              rate: iss.rate ?? '0',
              amount: iss.amount,
            },
            ...federal,
          ]
        : [...federal];

    const net = netReceivable({
      gross,
      discount,
      withholdings: federal,
      issWithheldAmount,
    });
    if (net.isNegative()) {
      return err(
        fiscalError({
          code: 'FISCAL_VALIDATION_FAILED',
          message: 'Net receivable amount is negative after tax withholdings',
          category: 'VALIDATION',
          step: this.name,
          details: { reason: 'negative_net_receivable' },
        }),
      );
    }

    const legacyTaxes: LegacyTaxResult = {
      iss,
      issWithheld: issWithheldAmount !== null,
      issResponsible:
        iss === null
          ? null
          : issWithheldAmount !== null
            ? 'CUSTOMER'
            : 'PROVIDER',
      withholdings,
      netReceivableAmount: moneyString(net),
    };

    const warnings = [
      ...context.warnings,
      ...(iss !== null && discount.greaterThan(0)
        ? [
            {
              code: 'UNCONDITIONAL_DISCOUNT_DEDUCTED',
              message:
                'Desconto incondicional deduzido da base de cálculo do ISS (LC 116/2003, art. 7º)',
              step: this.name,
            },
          ]
        : []),
      ...(deduction.greaterThan(0)
        ? [
            {
              code: 'DECLARED_DEDUCTION_APPLIED',
              message:
                'Dedução declarada pelo emitente abatida da base de cálculo do ISS e enviada na DPS. O emitente responde pelo valor declarado.',
              step: this.name,
            },
          ]
        : []),
    ];

    return ok({
      status: 'applied',
      context: { ...context, legacyTaxes, warnings },
    });
  }
}
