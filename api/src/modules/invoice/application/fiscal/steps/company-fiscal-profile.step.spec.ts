import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { IFiscalProfileReader } from '@/modules/invoice/domain/fiscal/ports/fiscal-profile.reader';
import type { Result } from '@/modules/invoice/domain/fiscal/result';
import type { StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import { contextFor } from '../testing/context';
import { CompanyFiscalProfileStep } from './company-fiscal-profile.step';

const profile = (
  overrides: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'pf-1',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: false,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  validFrom: '2026-01-01',
  validUntil: null,
  source: 'onboarding',
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const readerOf = (
  findEffectiveByDate: IFiscalProfileReader['findEffectiveByDate'],
): IFiscalProfileReader => ({ findEffectiveByDate });

const outcomeOf = (result: Result<StepOutcome, FiscalError>): StepOutcome => {
  if (result.ok === false)
    throw new Error(`expected the step to succeed, got ${result.error.code}`);
  return result.value;
};

const errorOf = (result: Result<StepOutcome, FiscalError>): FiscalError => {
  if (result.ok === true) throw new Error('expected the step to fail');
  return result.error;
};

describe('CompanyFiscalProfileStep', () => {
  it('is a required step named CompanyFiscalProfile', () => {
    const step = new CompanyFiscalProfileStep(readerOf(async () => []));
    expect(step.name).toBe('CompanyFiscalProfile');
    expect(step.required).toBe(true);
  });

  it('applies the single effective profile and fills context.companyProfile', async () => {
    const effective = profile();
    const step = new CompanyFiscalProfileStep(
      readerOf(async () => [effective]),
    );
    const outcome = outcomeOf(await step.execute(contextFor()));
    expect(outcome.status).toBe('applied');
    expect(outcome.context.companyProfile).toEqual(effective);
  });

  it('queries the reader with the company, tenant and competence date (fato gerador)', async () => {
    const calls: Array<[string, string, string]> = [];
    const step = new CompanyFiscalProfileStep(
      readerOf(async (companyId, tenantId, date) => {
        calls.push([companyId, tenantId, date]);
        return [profile()];
      }),
    );
    await step.execute(
      contextFor({ invoice: { competenceDate: '2026-02-10' } }),
    );
    expect(calls).toEqual([['comp-1', 'ten-1', '2026-02-10']]);
  });

  it('uses the profile effective on the competence date, not the execution date', async () => {
    const early = profile({
      id: 'pf-early',
      taxRegime: 'MEI',
      validFrom: '2026-01-01',
      validUntil: '2026-06-01',
    });
    const late = profile({
      id: 'pf-late',
      taxRegime: 'SIMPLES_NACIONAL',
      validFrom: '2026-06-01',
    });
    const step = new CompanyFiscalProfileStep(
      readerOf(async (_companyId, _tenantId, date) => [
        date < '2026-06-01' ? early : late,
      ]),
    );
    const earlyResult = await step.execute(
      contextFor({ invoice: { competenceDate: '2026-02-10' } }),
    );
    const lateResult = await step.execute(
      contextFor({ invoice: { competenceDate: '2026-08-10' } }),
    );
    expect(
      earlyResult.ok && earlyResult.value.context.companyProfile?.taxRegime,
    ).toBe('MEI');
    expect(
      lateResult.ok && lateResult.value.context.companyProfile?.taxRegime,
    ).toBe('SIMPLES_NACIONAL');
  });

  it('fails with FISCAL_PROFILE_NOT_EFFECTIVE when no profile covers the competence date', async () => {
    const step = new CompanyFiscalProfileStep(readerOf(async () => []));
    const error = errorOf(await step.execute(contextFor()));
    expect(error).toMatchObject({
      code: 'FISCAL_PROFILE_NOT_EFFECTIVE',
      category: 'CONFIGURATION',
      retryable: false,
      step: 'CompanyFiscalProfile',
      details: { competenceDate: '2026-10-13' },
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when two effective profiles overlap', async () => {
    const step = new CompanyFiscalProfileStep(
      readerOf(async () => [profile({ id: 'pf-1' }), profile({ id: 'pf-2' })]),
    );
    const error = errorOf(await step.execute(contextFor()));
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      retryable: false,
      details: { reason: 'overlapping_fiscal_profiles', count: 2 },
    });
  });

  it('fails with FISCAL_INTERNAL_ERROR when the reader port is not wired', async () => {
    const step = new CompanyFiscalProfileStep(
      null as unknown as IFiscalProfileReader,
    );
    const error = errorOf(await step.execute(contextFor()));
    expect(error).toMatchObject({
      code: 'FISCAL_INTERNAL_ERROR',
      category: 'INTERNAL',
      details: { reason: 'fiscal_profile_reader_missing' },
    });
  });

  it('blocks an unreviewed profile in the live environment', async () => {
    const step = new CompanyFiscalProfileStep(
      readerOf(async () => [profile({ reviewStatus: 'unreviewed' })]),
    );
    const error = errorOf(
      await step.execute(contextFor({ invoice: { environment: 'live' } })),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_REVIEW_REQUIRED',
      category: 'CONFIGURATION',
      step: 'CompanyFiscalProfile',
      details: { profileId: 'pf-1', reviewStatus: 'unreviewed' },
    });
  });

  it('blocks a rejected profile in any environment', async () => {
    const step = new CompanyFiscalProfileStep(
      readerOf(async () => [profile({ reviewStatus: 'rejected' })]),
    );
    const error = errorOf(
      await step.execute(contextFor({ invoice: { environment: 'test' } })),
    );
    expect(error).toMatchObject({
      code: 'FISCAL_REVIEW_REQUIRED',
      category: 'CONFIGURATION',
      details: { profileId: 'pf-1', reviewStatus: 'rejected' },
    });
  });

  it('allows an approved profile in the live environment', async () => {
    const step = new CompanyFiscalProfileStep(
      readerOf(async () => [profile({ reviewStatus: 'approved' })]),
    );
    const outcome = outcomeOf(
      await step.execute(contextFor({ invoice: { environment: 'live' } })),
    );
    expect(outcome.status).toBe('applied');
    expect(outcome.context.companyProfile?.reviewStatus).toBe('approved');
    expect(outcome.context.warnings).toEqual([]);
  });

  it('applies an unreviewed profile in the test environment with a warning', async () => {
    const step = new CompanyFiscalProfileStep(
      readerOf(async () => [profile({ reviewStatus: 'unreviewed' })]),
    );
    const outcome = outcomeOf(
      await step.execute(contextFor({ invoice: { environment: 'test' } })),
    );
    expect(outcome.status).toBe('applied');
    expect(outcome.context.warnings).toEqual([
      {
        code: 'FISCAL_PROFILE_UNREVIEWED',
        message: 'Fiscal profile is not approved',
        step: 'CompanyFiscalProfile',
      },
    ]);
  });

  it('does not mutate the input context', async () => {
    const step = new CompanyFiscalProfileStep(
      readerOf(async () => [profile({ reviewStatus: 'unreviewed' })]),
    );
    const context = Object.freeze(contextFor());
    const snapshot = JSON.stringify(context);
    const outcome = outcomeOf(await step.execute(context));
    expect(JSON.stringify(context)).toBe(snapshot);
    expect(context.companyProfile).toBeUndefined();
    expect(outcome.context).not.toBe(context);
  });
});
