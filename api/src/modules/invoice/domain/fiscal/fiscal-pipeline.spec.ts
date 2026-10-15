import { fiscalError } from './fiscal-error';
import { FiscalPipeline } from './fiscal-pipeline';
import type { FiscalContext } from './fiscal-context';
import { initialFiscalContext } from './fiscal-context';
import type { FiscalStep } from './fiscal-step';
import type { NormalizedInvoice } from './normalized-invoice';
import { err, ok } from './result';

const invoice = (id: string): NormalizedInvoice => ({
  invoiceId: id,
  tenantId: 't',
  environment: 'test',
  company: {
    id: 'c',
    taxId: '11222333000181',
    municipalityCode: '3550308',
    municipalRegistration: null,
  },
  competenceDate: '2026-10-13',
  grossAmount: '50.00',
  discountAmount: '0.00',
  service: {
    code: '060101',
    municipalityCode: '3550308',
    description: null,
    fiscal: null,
    serviceProfileId: null,
  },
  customer: null,
});

const applied = (
  name: string,
  calls: string[],
  extra: Partial<FiscalContext> = {},
  delayMs = 0,
): FiscalStep => ({
  name,
  required: true,
  async execute(ctx) {
    calls.push(name);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return ok({ status: 'applied', context: { ...ctx, ...extra } });
  },
});

describe('FiscalPipeline', () => {
  it('runs steps in declared order and records a trace entry per step', async () => {
    const calls: string[] = [];
    const result = await new FiscalPipeline([
      applied('A', calls),
      applied('B', calls),
      applied('C', calls),
    ]).execute(initialFiscalContext(invoice('i1')));
    expect(calls).toEqual(['A', 'B', 'C']);
    expect(
      result.ok && result.value.trace.map((t) => [t.step, t.status]),
    ).toEqual([
      ['A', 'applied'],
      ['B', 'applied'],
      ['C', 'applied'],
    ]);
  });

  it('stops at the first failure, never runs later steps and stamps the step name', async () => {
    const calls: string[] = [];
    const failing: FiscalStep = {
      name: 'B',
      required: true,
      async execute() {
        calls.push('B');
        return err(
          fiscalError({
            code: 'FISCAL_CLASSIFICATION_REQUIRED',
            message: 'm',
            category: 'CLASSIFICATION',
            details: { missingFields: ['service.fiscal.nbsCode'] },
          }),
        );
      },
    };
    const result = await new FiscalPipeline([
      applied('A', calls),
      failing,
      applied('C', calls),
    ]).execute(initialFiscalContext(invoice('i1')));
    expect(calls).toEqual(['A', 'B']);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'FISCAL_CLASSIFICATION_REQUIRED',
        step: 'B',
        category: 'CLASSIFICATION',
        retryable: false,
        details: { missingFields: ['service.fiscal.nbsCode'] },
      },
    });
  });

  it('propagates the context produced by earlier steps', async () => {
    const seen: unknown[] = [];
    const reader: FiscalStep = {
      name: 'R',
      required: true,
      async execute(ctx) {
        seen.push(ctx.warnings);
        return ok({ status: 'applied', context: ctx });
      },
    };
    const writer = applied('W', [], {
      warnings: [{ code: 'X', message: 'm', step: 'W' }],
    });
    await new FiscalPipeline([writer, reader]).execute(
      initialFiscalContext(invoice('i1')),
    );
    expect(seen).toEqual([[{ code: 'X', message: 'm', step: 'W' }]]);
  });

  it('records skipped optional steps with the reason and continues', async () => {
    const calls: string[] = [];
    const optional: FiscalStep = {
      name: 'O',
      required: false,
      async execute(ctx) {
        calls.push('O');
        return ok({
          status: 'skipped',
          context: ctx,
          reason: 'not applicable',
        });
      },
    };
    const result = await new FiscalPipeline([
      optional,
      applied('B', calls),
    ]).execute(initialFiscalContext(invoice('i1')));
    expect(calls).toEqual(['O', 'B']);
    expect(result.ok && result.value.trace[0]).toMatchObject({
      step: 'O',
      status: 'skipped',
      reason: 'not applicable',
    });
  });

  it('rejects a required step that returns skipped', async () => {
    const sneaky: FiscalStep = {
      name: 'S',
      required: true,
      async execute(ctx) {
        return ok({ status: 'skipped', context: ctx, reason: 'nope' });
      },
    };
    const result = await new FiscalPipeline([sneaky]).execute(
      initialFiscalContext(invoice('i1')),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'FISCAL_INTERNAL_ERROR', category: 'INTERNAL', step: 'S' },
    });
  });

  it('does not mutate the initial context', async () => {
    const initial = initialFiscalContext(invoice('i1'));
    const frozen = JSON.stringify(initial);
    await new FiscalPipeline([
      applied('A', [], { warnings: [{ code: 'X', message: 'm', step: 'A' }] }),
    ]).execute(initial);
    expect(JSON.stringify(initial)).toBe(frozen);
  });

  it('keeps concurrent executions isolated', async () => {
    const pipeline = new FiscalPipeline([
      applied('A', [], {}, 15),
      applied('B', [], {}, 5),
    ]);
    const [a, b] = await Promise.all([
      pipeline.execute(initialFiscalContext(invoice('inv-a'))),
      pipeline.execute(initialFiscalContext(invoice('inv-b'))),
    ]);
    expect(a.ok && a.value.invoice.invoiceId).toBe('inv-a');
    expect(b.ok && b.value.invoice.invoiceId).toBe('inv-b');
    expect(a.ok && a.value.trace).toHaveLength(2);
  });

  it('lets unexpected exceptions propagate (bugs/infra are retried by the outbox)', async () => {
    const boom: FiscalStep = {
      name: 'X',
      required: true,
      async execute() {
        throw new Error('db down');
      },
    };
    await expect(
      new FiscalPipeline([boom]).execute(initialFiscalContext(invoice('i1'))),
    ).rejects.toThrow('db down');
  });

  it('rejects duplicate step names at construction', () => {
    expect(
      () => new FiscalPipeline([applied('A', []), applied('A', [])]),
    ).toThrow('Duplicate fiscal step name: A');
  });

  it('reports every step and the pipeline outcome to the observer', async () => {
    const observer = { stepFinished: jest.fn(), pipelineFinished: jest.fn() };
    await new FiscalPipeline([applied('A', [])], observer).execute(
      initialFiscalContext(invoice('i1')),
    );
    expect(observer.stepFinished).toHaveBeenCalledWith(
      'A',
      'applied',
      expect.any(Number),
      undefined,
    );
    expect(observer.pipelineFinished).toHaveBeenCalledWith(
      true,
      expect.any(Number),
      undefined,
    );
  });
});

describe('FiscalPipeline.executeWithPartial', () => {
  it('retains the last applied context and trace, stamps the failure and stops', async () => {
    const calls: string[] = [];
    const failure: FiscalStep = {
      name: 'B',
      required: true,
      execute: async () =>
        err(
          fiscalError({
            code: 'FISCAL_CLASSIFICATION_REQUIRED',
            message: 'missing',
            category: 'CLASSIFICATION',
          }),
        ),
    };
    const initial = initialFiscalContext(invoice('partial'));
    const result = await new FiscalPipeline([
      applied('A', calls, {
        warnings: [{ code: 'X', message: 'retained', step: 'A' }],
      }),
      failure,
      applied('C', calls),
    ]).executeWithPartial(initial);
    expect(result.error).toMatchObject({
      code: 'FISCAL_CLASSIFICATION_REQUIRED',
      step: 'B',
    });
    expect(result.context.warnings).toEqual([
      { code: 'X', message: 'retained', step: 'A' },
    ]);
    expect(result.context.trace.map((t) => t.step)).toEqual(['A']);
    expect(calls).toEqual(['A']);
    expect(initial.trace).toEqual([]);
  });
  it('returns an internal error with the preceding context for required skips', async () => {
    const initial = initialFiscalContext(invoice('skip'));
    const result = await new FiscalPipeline([
      {
        name: 'S',
        required: true,
        execute: async (context) =>
          ok({ status: 'skipped', context, reason: 'missing' }),
      },
    ]).executeWithPartial(initial);
    expect(result.error).toMatchObject({ category: 'INTERNAL' });
    expect(result.context).toBe(initial);
  });
});
