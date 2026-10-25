import { Inject, Injectable } from '@nestjs/common';
import { todayInEstablishmentTimezone } from '@/shared/dates/date-time';
import {
  FiscalValidationError,
  type FiscalIssue,
} from '@/shared/fiscal/fiscal-validation-error';
import {
  ISimplesRateRepository,
  type SimplesRate,
  type SimplesRateInput,
} from '../domain/simples-rate';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const RATE_FIELDS = ['totalRate', 'issRate', 'ibsRate', 'cbsRate'] as const;

function monthIndex(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  return year * 12 + mon;
}

function rateIssue(
  field: (typeof RATE_FIELDS)[number],
  value: string,
): FiscalIssue | null {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text) && !/^-/.test(text)) {
    return { field, code: 'invalid', message: `${field} must be a number` };
  }
  const [, fraction] = text.split('.');
  if (Number.isNaN(Number(text)))
    return { field, code: 'invalid', message: `${field} must be a number` };
  if ((fraction?.length ?? 0) > 2)
    return {
      field,
      code: 'invalid_decimal_places',
      message: `${field} must have at most 2 decimal places`,
    };
  if (Number(text) < 0 || Number(text) > 100)
    return {
      field,
      code: 'out_of_range',
      message: `${field} must be between 0 and 100`,
    };
  return null;
}

/**
 * Monthly rates of a Simples Nacional company. Corvo does not compute the DAS:
 * the company or its accountant informs these values.
 */
@Injectable()
export class SimplesRateService {
  constructor(
    @Inject(ISimplesRateRepository)
    private readonly rates: ISimplesRateRepository,
  ) {}

  async put(
    companyId: string,
    tenantId: string,
    month: string,
    input: SimplesRateInput,
  ): Promise<SimplesRate> {
    const issues: FiscalIssue[] = [];
    if (!MONTH.test(month))
      issues.push({
        field: 'month',
        code: 'invalid_date',
        message: 'month must be YYYY-MM',
      });
    else if (month > todayInEstablishmentTimezone().slice(0, 7))
      issues.push({
        field: 'month',
        code: 'future_date',
        message: 'month cannot be in the future',
      });
    for (const field of RATE_FIELDS) {
      const value = input[field];
      if (value === null || value === undefined) continue;
      const issue = rateIssue(field, value);
      if (issue) issues.push(issue);
    }
    if (issues.length > 0) throw new FiscalValidationError(issues);
    return this.rates.upsert(companyId, tenantId, month, input);
  }

  list(companyId: string, tenantId: string): Promise<SimplesRate[]> {
    return this.rates.list(companyId, tenantId);
  }

  /**
   * The rate for an invoice: the competence month, else the closest previous
   * informed month. `stale` when that month is more than one month behind.
   */
  async resolve(
    companyId: string,
    tenantId: string,
    competenceDate: string,
  ): Promise<{ rate: SimplesRate | null; stale: boolean }> {
    const month = competenceDate.slice(0, 7);
    const rate = await this.rates.findAtOrBefore(companyId, tenantId, month);
    if (rate === null) return { rate: null, stale: false };
    return { rate, stale: monthIndex(month) - monthIndex(rate.month) > 1 };
  }
}
