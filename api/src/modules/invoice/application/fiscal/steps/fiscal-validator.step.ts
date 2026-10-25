import { Injectable } from '@nestjs/common';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import type {
  FiscalStep,
  StepOutcome,
} from '@/modules/invoice/domain/fiscal/fiscal-step';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import { validateFiscalContext } from '@/modules/invoice/domain/fiscal/validation/fiscal-validator';

@Injectable()
export class FiscalValidatorStep implements FiscalStep {
  readonly name = 'FiscalValidator';
  readonly required = true;

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(
    context: Readonly<FiscalContext>,
  ): Promise<Result<StepOutcome, FiscalError>> {
    const { errors } = validateFiscalContext(context);
    if (errors.length > 0) {
      return err(
        fiscalError({
          code: 'FISCAL_VALIDATION_FAILED',
          message: `The fiscal context failed validation with ${errors.length} issue(s)`,
          category: 'VALIDATION',
          step: this.name,
          details: { issues: errors },
        }),
      );
    }
    return ok({ status: 'applied', context });
  }
}
