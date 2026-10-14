import type { FiscalError } from './fiscal-error';
import type { FiscalContext } from './fiscal-context';
import type { Result } from './result';

export type StepOutcome =
  | { readonly status: 'applied'; readonly context: FiscalContext }
  | {
      readonly status: 'skipped';
      readonly context: FiscalContext;
      readonly reason: string;
    };

export interface FiscalStep {
  readonly name: string;
  /** Required steps may not return 'skipped'. */
  readonly required: boolean;
  execute(
    context: Readonly<FiscalContext>,
  ): Promise<Result<StepOutcome, FiscalError>>;
}
