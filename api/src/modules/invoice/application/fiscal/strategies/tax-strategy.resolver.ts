import { Injectable } from '@nestjs/common';
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import { fiscalError, type FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import type { TaxStrategy } from './tax-strategy';

@Injectable()
export class TaxStrategyResolver {
  constructor(private readonly strategies: readonly TaxStrategy[]) {}

  resolve(
    profile: CompanyFiscalProfile,
    competenceDate: string,
  ): Result<TaxStrategy, FiscalError> {
    const matching = this.strategies.filter((strategy) =>
      strategy.supports(profile, competenceDate),
    );
    if (matching.length === 1) return ok(matching[0]);

    if (matching.length === 0) {
      return err(
        fiscalError({
          code: 'TAX_REGIME_UNSUPPORTED',
          category: 'UNSUPPORTED',
          step: 'TaxStrategyResolver.resolve',
          message: `No tax strategy supports regime "${profile.taxRegime}"`,
          details: { regime: profile.taxRegime },
        }),
      );
    }
    return err(
      fiscalError({
        code: 'TAX_REGIME_UNSUPPORTED',
        category: 'UNSUPPORTED',
        step: 'TaxStrategyResolver.resolve',
        message: 'Multiple tax strategies claim the same fiscal profile',
        details: { ambiguousStrategies: matching.map((strategy) => strategy.name) },
      }),
    );
  }
}
