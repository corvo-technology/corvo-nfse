import { OperationEmitter } from './operation-emitter.service';
import {
  MemoryEvents,
  MemoryOperations,
  MemoryRules,
} from '../testing/memory-repositories';
import {
  InvoiceCancellationPort,
  type CancelInvoiceCommand,
  type CancelInvoiceResult,
} from '../domain/invoice-cancellation.port';
import {
  InvoiceIssuancePort,
  type IssueInvoiceCommand,
} from '../domain/invoice-issuance.port';
import type { IntegrationConnection } from '../domain/integration-connection';
import type { NormalizedOperation } from '../domain/connector';
import type { ConnectionService } from './connection.service';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { QuotaExceededError } from '@/modules/plans/application/quota.service';
import { IdempotencyConflictError } from '@/modules/invoice/domain/errors';
import {
  CompanyBlockedError,
  CompanyNotReadyError,
} from '@/modules/company/domain/errors';

const TENANT = '11111111-1111-4111-8111-111111111111';

class FakeIssuance extends InvoiceIssuancePort {
  calls: IssueInvoiceCommand[] = [];
  error: Error | null = null;
  private byKey = new Map<string, string>();
  issue(command: IssueInvoiceCommand) {
    this.calls.push(command);
    if (this.error) return Promise.reject(this.error);
    const known = this.byKey.get(command.idempotencyKey);
    if (known) return Promise.resolve({ invoiceId: known, replay: true });
    const id = `inv${this.byKey.size + 1}`;
    this.byKey.set(command.idempotencyKey, id);
    return Promise.resolve({ invoiceId: id, replay: false });
  }
}

class FakeCancellation extends InvoiceCancellationPort {
  calls: CancelInvoiceCommand[] = [];
  result: CancelInvoiceResult = { ok: true };
  error: Error | null = null;
  cancel(command: CancelInvoiceCommand) {
    this.calls.push(command);
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.result);
  }
}

const snapshot = (
  over: Partial<NormalizedOperation> = {},
): NormalizedOperation => ({
  operationKey: 'charge:1',
  commercialState: 'paid',
  externalRefs: {},
  occurredAt: new Date('2026-10-29T12:00:00Z'),
  paidAt: new Date('2026-10-29T12:00:00Z'),
  currency: 'BRL',
  amountCents: 4990,
  discountCents: 0,
  customer: {
    name: 'Maria',
    email: null,
    taxId: '52998224725',
    taxIdMasked: false,
  },
  items: [],
  sellerIssuesInvoice: true,
  ...over,
});

function setup() {
  const connection: IntegrationConnection = {
    id: 'c1',
    tenantId: TENANT,
    companyId: 'co1',
    publicId: 'pub',
    provider: 'fake',
    environment: 'test',
    externalAccountId: 'acc',
    state: 'active',
    credentialsEnc: 'enc',
    activeFrom: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const connections = {
    get: jest.fn().mockImplementation(() => Promise.resolve({ ...connection })),
  } as unknown as ConnectionService;
  const operations = new MemoryOperations();
  const rules = new MemoryRules();
  rules.rules = [
    {
      id: 'r1',
      tenantId: TENANT,
      connectionId: 'c1',
      externalProductId: null,
      service: { code: '010101' },
      sendEmail: false,
      allowAnonymousCustomer: false,
      cancelOnRefund: false,
    },
  ];
  const issuance = new FakeIssuance();
  const events = new MemoryEvents();
  const cancellation = new FakeCancellation();
  const emitter = new OperationEmitter(
    connections,
    operations,
    rules,
    issuance,
    events,
    cancellation,
  );
  const upsert = (n: NormalizedOperation) =>
    operations.upsertFromNormalized({
      tenantId: TENANT,
      connectionId: 'c1',
      provider: 'fake',
      environment: 'test',
      externalAccountId: 'acc',
      normalized: n,
    });
  return {
    emitter,
    operations,
    rules,
    issuance,
    connection,
    upsert,
    events,
    cancellation,
  };
}

describe('OperationEmitter', () => {
  it('issues once for a paid operation and stores the invoice id', async () => {
    const { emitter, issuance, upsert, operations } = setup();
    const op = await upsert(snapshot());
    const outcome = await emitter.run(op);
    expect(outcome).toEqual({ state: 'processed', operationId: op.id });
    expect(issuance.calls).toHaveLength(1);
    expect(issuance.calls[0]).toMatchObject({
      tenantId: TENANT,
      environment: 'test',
      idempotencyKey: expect.stringMatching(/^integ_/),
    });
    expect(operations.rows.get(op.id)).toMatchObject({
      fiscalStatus: 'submitted',
      invoiceId: 'inv1',
    });
  });

  describe('earlier notices that were left waiting', () => {
    const waiting = (operationId: string) => ({
      id: `e-${operationId}`,
      operationId,
      state: 'needs_attention' as const,
      lastError: 'customer_tax_id_missing',
    });

    it('count as processed once the sale gets its invoice', async () => {
      const { emitter, upsert, events } = setup();
      const op = await upsert(snapshot());
      events.rows.push(waiting(op.id), waiting('another-sale'));
      await emitter.run(op);
      expect(events.rows[0]).toMatchObject({
        state: 'processed',
        lastError: null,
      });
      expect(events.rows[1].state).toBe('needs_attention');
    });

    it('count as processed when a repeated notice finds the invoice already issued', async () => {
      const { emitter, upsert, events, operations } = setup();
      const op = await upsert(snapshot());
      await emitter.run(op);
      events.rows.push(waiting(op.id));
      await emitter.run(operations.rows.get(op.id)!);
      expect(events.rows[0].state).toBe('processed');
    });

    it('stay as they are while the sale still has no invoice', async () => {
      const { emitter, upsert, events } = setup();
      const op = await upsert(
        snapshot({
          customer: { name: 'M', email: null, taxId: null, taxIdMasked: true },
        }),
      );
      events.rows.push(waiting(op.id));
      await emitter.run(op);
      expect(events.rows[0].state).toBe('needs_attention');
    });
  });

  it('does not issue when the connection was paused or disconnected after the event arrived', async () => {
    for (const state of [
      'paused',
      'disconnected',
      'reauth_required',
    ] as const) {
      const { emitter, issuance, upsert, connection, operations } = setup();
      connection.state = state;
      const op = await upsert(snapshot());
      await emitter.run(op);
      expect(issuance.calls).toHaveLength(0);
      expect(operations.rows.get(op.id)).toMatchObject({
        fiscalStatus: 'blocked',
        blockReason: 'connection_inactive',
      });
    }
  });

  it('freezes the request before issuing and a retry after a crash reuses the same key and request', async () => {
    const { emitter, issuance, upsert, operations } = setup();
    const op = await upsert(snapshot());
    jest
      .spyOn(operations, 'setFiscal')
      .mockImplementationOnce(() =>
        Promise.reject(new Error('crash before saving invoice id')),
      );
    await expect(emitter.run(op)).rejects.toThrow('crash');
    const frozen = operations.rows.get(op.id)!;
    expect(frozen.emissionRequest).not.toBeNull();
    await emitter.run(frozen);
    expect(issuance.calls).toHaveLength(2);
    expect(issuance.calls[1].idempotencyKey).toBe(
      issuance.calls[0].idempotencyKey,
    );
    expect(issuance.calls[1].request).toEqual(issuance.calls[0].request);
    expect(operations.rows.get(op.id)).toMatchObject({
      fiscalStatus: 'submitted',
      invoiceId: 'inv1',
    });
  });

  it('a retry after the rule changed reuses the stored request and key', async () => {
    const { emitter, issuance, upsert, operations, rules } = setup();
    const op = await upsert(snapshot());
    issuance.error = new Error('temporary');
    await expect(emitter.run(op)).rejects.toThrow('temporary');
    issuance.error = null;
    rules.rules = [
      { ...rules.rules[0], service: { code: '999999' }, sendEmail: true },
    ];
    await emitter.run(operations.rows.get(op.id)!);
    expect(issuance.calls[1].request).toEqual(issuance.calls[0].request);
    expect(issuance.calls[1].request.service).toEqual({ code: '010101' });
  });

  it('a refund after the invoice exists flags refund_after_invoice and keeps the fiscal status', async () => {
    const { emitter, upsert, operations } = setup();
    const op = await upsert(snapshot());
    await emitter.run(op);
    const refunded = await upsert(
      snapshot({
        commercialState: 'refunded',
        occurredAt: new Date('2026-10-29T15:00:00Z'),
      }),
    );
    const outcome = await emitter.run(refunded);
    expect(outcome.state).toBe('processed');
    expect(operations.rows.get(op.id)).toMatchObject({
      fiscalStatus: 'submitted',
      blockReason: 'refund_after_invoice',
      commercialState: 'refunded',
    });
  });

  describe('refund after the invoice with "cancel on refund"', () => {
    const refundedAt = new Date('2026-10-29T15:00:00Z');
    async function issuedThenRefunded(
      cancelOnRefund: boolean,
      state: 'refunded' | 'disputed' = 'refunded',
    ) {
      const ctx = setup();
      ctx.rules.rules = [{ ...ctx.rules.rules[0], cancelOnRefund }];
      const op = await ctx.upsert(snapshot());
      await ctx.emitter.run(op);
      const later = await ctx.upsert(
        snapshot({ commercialState: state, occurredAt: refundedAt }),
      );
      return { ...ctx, op, later };
    }

    it('asks for the invoice to be cancelled, once, with the fixed reason text', async () => {
      const { emitter, later, cancellation, operations, op } =
        await issuedThenRefunded(true);
      await expect(emitter.run(later)).resolves.toEqual({
        state: 'processed',
        operationId: op.id,
      });
      expect(cancellation.calls).toEqual([
        {
          tenantId: TENANT,
          environment: 'test',
          invoiceId: 'inv1',
          description: 'Cancelado por reembolso',
        },
      ]);
      expect(operations.rows.get(op.id)).toMatchObject({
        fiscalStatus: 'submitted',
        blockReason: 'cancel_requested',
        invoiceId: 'inv1',
      });
    });

    it('does nothing more when the same refund arrives again', async () => {
      const { emitter, later, cancellation, operations, op } =
        await issuedThenRefunded(true);
      await emitter.run(later);
      await emitter.run(operations.rows.get(op.id)!);
      expect(cancellation.calls).toHaveLength(1);
    });

    it('stays as before when the setting is off: only flags the refund', async () => {
      const { emitter, later, cancellation, operations, op } =
        await issuedThenRefunded(false);
      await emitter.run(later);
      expect(cancellation.calls).toHaveLength(0);
      expect(operations.rows.get(op.id)).toMatchObject({
        blockReason: 'refund_after_invoice',
      });
    });

    it('a dispute never cancels, even with the setting on', async () => {
      const { emitter, later, cancellation, operations, op } =
        await issuedThenRefunded(true, 'disputed');
      await emitter.run(later);
      expect(cancellation.calls).toHaveLength(0);
      expect(operations.rows.get(op.id)).toMatchObject({
        blockReason: 'refund_after_invoice',
      });
    });

    it('an invoice that cannot be cancelled asks for attention and keeps the invoice, and trying again cancels', async () => {
      const { emitter, later, cancellation, operations, op } =
        await issuedThenRefunded(true);
      cancellation.result = { ok: false, message: 'not cancellable' };
      await expect(emitter.run(later)).resolves.toEqual({
        state: 'needs_attention',
        operationId: op.id,
        lastError: 'not cancellable',
      });
      expect(operations.rows.get(op.id)).toMatchObject({
        fiscalStatus: 'needs_attention',
        blockReason: 'cancel_failed',
        invoiceId: 'inv1',
      });
      cancellation.result = { ok: true };
      await emitter.run(operations.rows.get(op.id)!);
      expect(cancellation.calls).toHaveLength(2);
      expect(operations.rows.get(op.id)).toMatchObject({
        fiscalStatus: 'submitted',
        blockReason: 'cancel_requested',
      });
    });

    it('an unexpected error propagates so the event is retried, leaving the sale as it was', async () => {
      const { emitter, later, cancellation, operations, op } =
        await issuedThenRefunded(true);
      cancellation.error = new Error('db down');
      await expect(emitter.run(later)).rejects.toThrow('db down');
      expect(operations.rows.get(op.id)?.blockReason).toBeNull();
    });

    it('still cancels after the client saved the rules again, which gives them new ids', async () => {
      const { emitter, later, rules, cancellation, operations, op } =
        await issuedThenRefunded(true);
      // Saving the settings replaces every rule row: the sale's remembered rule id no longer exists.
      rules.rules = [{ ...rules.rules[0], id: 'r-after-edit' }];
      await emitter.run(later);
      expect(cancellation.calls).toHaveLength(1);
      expect(operations.rows.get(op.id)?.blockReason).toBe('cancel_requested');
    });

    it('uses the rule of the sale product when there is one, otherwise the default rule', async () => {
      const ctx = setup();
      const base = ctx.rules.rules[0];
      ctx.rules.rules = [
        { ...base, id: 'default', cancelOnRefund: false },
        {
          ...base,
          id: 'product',
          externalProductId: 'prod-1',
          cancelOnRefund: true,
        },
      ];
      const item = {
        externalProductId: 'prod-1',
        description: null,
        quantity: 1,
      };
      const withProduct = await ctx.upsert(
        snapshot({ operationKey: 'charge:p', items: [item] }),
      );
      await ctx.emitter.run(withProduct);
      const refundedProduct = await ctx.upsert(
        snapshot({
          operationKey: 'charge:p',
          items: [item],
          commercialState: 'refunded',
          occurredAt: new Date('2026-10-29T15:00:00Z'),
        }),
      );
      await ctx.emitter.run(refundedProduct);
      expect(ctx.cancellation.calls).toHaveLength(1);
    });

    it('turning the setting off later does not undo a cancellation already requested', async () => {
      const { emitter, later, rules, operations, op, cancellation } =
        await issuedThenRefunded(true);
      await emitter.run(later);
      rules.rules = [{ ...rules.rules[0], cancelOnRefund: false }];
      await emitter.run(operations.rows.get(op.id)!);
      expect(cancellation.calls).toHaveLength(1);
      expect(operations.rows.get(op.id)?.blockReason).toBe('cancel_requested');
    });

    it('notices left waiting for this sale count as processed once the cancellation is requested', async () => {
      const { emitter, later, events, op } = await issuedThenRefunded(true);
      events.rows.push({
        id: 'e1',
        operationId: op.id,
        state: 'needs_attention',
        lastError: 'x',
      });
      await emitter.run(later);
      expect(events.rows[0].state).toBe('processed');
    });
  });

  it('a refund before any invoice blocks the emission', async () => {
    const { emitter, issuance, upsert, operations } = setup();
    await upsert(snapshot({ commercialState: 'refunded' }));
    const late = await upsert(snapshot());
    await emitter.run(late);
    expect(issuance.calls).toHaveLength(0);
    expect(operations.rows.get(late.id)).toMatchObject({
      fiscalStatus: 'blocked',
      blockReason: 'refunded',
    });
  });

  it('a masked customer needs attention; completing the customer and retrying issues', async () => {
    const { emitter, issuance, upsert, operations } = setup();
    const op = await upsert(
      snapshot({
        customer: { name: 'M', email: null, taxId: null, taxIdMasked: true },
      }),
    );
    const outcome = await emitter.run(op);
    expect(outcome).toMatchObject({
      state: 'needs_attention',
      lastError: 'customer_tax_id_missing',
    });
    expect(issuance.calls).toHaveLength(0);
    const fixed = await operations.updateCustomer(op.id, TENANT, {
      name: 'Maria',
      email: null,
      taxId: '52998224725',
      taxIdMasked: false,
    });
    await emitter.run(fixed!);
    expect(issuance.calls).toHaveLength(1);
  });

  it('FiscalValidationError becomes needs_attention invoice_rejected with the message', async () => {
    const { emitter, issuance, upsert, operations } = setup();
    issuance.error = new FiscalValidationError([
      {
        field: 'service.code',
        code: 'invalid',
        message: 'service.code is not valid',
      },
    ]);
    const op = await upsert(snapshot());
    const outcome = await emitter.run(op);
    expect(outcome.state).toBe('needs_attention');
    expect(operations.rows.get(op.id)).toMatchObject({
      fiscalStatus: 'needs_attention',
      blockReason: 'invoice_rejected',
    });
  });

  it('QuotaExceededError becomes needs_attention quota_exceeded', async () => {
    const { emitter, issuance, upsert, operations } = setup();
    issuance.error = new QuotaExceededError('no_credits' as never, {});
    const op = await upsert(snapshot());
    await emitter.run(op);
    expect(operations.rows.get(op.id)).toMatchObject({
      fiscalStatus: 'needs_attention',
      blockReason: 'quota_exceeded',
    });
  });

  it('IdempotencyConflictError becomes needs_attention invoice_rejected, never a new key', async () => {
    const { emitter, issuance, upsert, operations } = setup();
    issuance.error = new IdempotencyConflictError('integ_x');
    const op = await upsert(snapshot());
    await emitter.run(op);
    expect(operations.rows.get(op.id)).toMatchObject({
      blockReason: 'invoice_rejected',
    });
  });

  it('an unexpected error propagates so the event is retried', async () => {
    const { emitter, issuance, upsert } = setup();
    issuance.error = new Error('db down');
    await expect(emitter.run(await upsert(snapshot()))).rejects.toThrow(
      'db down',
    );
  });

  it('after invoice_rejected the frozen request is released, so fixing the rule and retrying issues the corrected invoice', async () => {
    const { emitter, issuance, upsert, operations, rules } = setup();
    issuance.error = new FiscalValidationError([
      {
        field: 'service.code',
        code: 'invalid',
        message: 'service.code is not valid',
      },
    ]);
    const op = await upsert(snapshot());
    await emitter.run(op);
    expect(operations.rows.get(op.id)).toMatchObject({
      emissionRequest: null,
      idempotencyKey: null,
      fiscalStatus: 'needs_attention',
      blockReason: 'invoice_rejected',
    });
    issuance.error = null;
    rules.rules = [{ ...rules.rules[0], service: { code: '020202' } }];
    await emitter.run(operations.rows.get(op.id)!);
    expect(issuance.calls[1].request.service).toEqual({ code: '020202' });
    expect(operations.rows.get(op.id)).toMatchObject({
      fiscalStatus: 'submitted',
    });
  });

  it.each([
    [
      'CompanyNotReadyError',
      () => new CompanyNotReadyError('co1', ['certificate']),
    ],
    ['CompanyBlockedError', () => new CompanyBlockedError('co1')],
  ])(
    '%s becomes needs_attention company_not_ready instead of burning retries',
    async (_name, make) => {
      const { emitter, issuance, upsert, operations } = setup();
      issuance.error = make();
      const op = await upsert(snapshot());
      const outcome = await emitter.run(op);
      expect(outcome.state).toBe('needs_attention');
      expect(operations.rows.get(op.id)).toMatchObject({
        fiscalStatus: 'needs_attention',
        blockReason: 'company_not_ready',
        emissionRequest: null,
      });
    },
  );
});
