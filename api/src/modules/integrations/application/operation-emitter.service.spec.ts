import { Logger } from '@nestjs/common';
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
    connections,
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

  it('logs a blocked stop with its reason and no customer data', async () => {
    const { emitter, upsert } = setup();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await upsert(snapshot({ commercialState: 'refunded' }));
    const late = await upsert(snapshot());
    await emitter.run(late);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'blocked', reason: 'refunded' }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Maria');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('52998224725');
    warn.mockRestore();
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
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
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
    expect(warn).toHaveBeenCalledWith({
      event: 'integration_operation_stopped',
      tenantId: TENANT,
      connectionId: 'c1',
      operationId: op.id,
      operationKey: 'charge:1',
      state: 'needs_attention',
      reason: 'customer_tax_id_missing',
    });
    warn.mockRestore();
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

describe('OperationEmitter notices', () => {
  const live = (n: NormalizedOperation) => n;
  function withBus() {
    const ctx = setup();
    const published: Array<{
      tenantId: string;
      notice: Record<string, unknown>;
    }> = [];
    const bus = {
      publishBestEffort: (event: {
        tenantId: string;
        notice: Record<string, unknown>;
      }) => published.push(event),
    };
    const emitter = new OperationEmitter(
      ctx.connections,
      ctx.operations,
      ctx.rules,
      ctx.issuance,
      ctx.events,
      new FakeCancellation(),
      bus as never,
    );
    const seedLive = (n: NormalizedOperation) =>
      ctx.operations.upsertFromNormalized({
        tenantId: TENANT,
        connectionId: 'c1',
        provider: 'woovi',
        environment: 'live',
        externalAccountId: 'acc',
        normalized: live(n),
      });
    return { ...ctx, emitter, published, seedLive };
  }

  it('announces a live sale that waits for the client, with what the owner needs', async () => {
    const { emitter, published, seedLive } = withBus();
    const op = await seedLive(
      snapshot({
        customer: {
          name: 'ACME',
          email: null,
          taxId: null,
          taxIdMasked: false,
        },
      }),
    );
    await emitter.run(op);
    expect(published).toHaveLength(1);
    expect(published[0].tenantId).toBe(TENANT);
    expect(published[0].notice).toMatchObject({
      kind: 'integration-sale-needs-attention',
      operationId: op.id,
      provider: 'woovi',
      amountCents: 4990,
      buyerName: 'ACME',
      reason: 'customer_tax_id_missing',
      pendingCount: 1,
    });
  });

  it('says nothing for a test sale or one that blocks for a reason the client cannot act on', async () => {
    const { emitter, published, upsert, seedLive } = withBus();
    await emitter.run(
      await upsert(
        snapshot({
          operationKey: 'c:t',
          customer: null,
        }),
      ),
    );
    await emitter.run(
      await seedLive(snapshot({ operationKey: 'c:r', currency: 'USD' })),
    );
    expect(published).toHaveLength(0);
  });

  it('does not run again for a sale the client chose to ignore', async () => {
    const { emitter, published, issuance, operations, seedLive } = withBus();
    const op = await seedLive(snapshot());
    await operations.setFiscal(op.id, TENANT, 'blocked', 'ignored_by_user');
    const outcome = await emitter.run(
      (await operations.findById(op.id, TENANT))!,
    );
    expect(outcome.state).toBe('processed');
    expect(issuance.calls).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});

describe('OperationEmitter with saved customers', () => {
  function withSaved(
    saved: { name: string; email: string | null } | null | 'fail',
  ) {
    const ctx = setup();
    ctx.rules.rules = ctx.rules.rules.map((rule) => ({
      ...rule,
      sendEmail: true,
    }));
    const find = jest
      .fn()
      .mockImplementation(() =>
        saved === 'fail'
          ? Promise.reject(new Error('db down'))
          : Promise.resolve(saved),
      );
    const emitter = new OperationEmitter(
      ctx.connections,
      ctx.operations,
      ctx.rules,
      ctx.issuance,
      ctx.events,
      new FakeCancellation(),
      undefined,
      { find },
    );
    return { ...ctx, emitter, find };
  }
  const buyer = (over: Partial<NonNullable<NormalizedOperation['customer']>>) =>
    snapshot({
      customer: {
        name: 'EMPRESA EXEMPLO',
        email: null,
        taxId: '11222333000181',
        taxIdMasked: false,
        ...over,
      },
    });

  it('a Woovi sale without e-mail goes to the e-mail the workspace has saved for that CNPJ', async () => {
    const { emitter, issuance, upsert, find } = withSaved({
      name: 'Empresa Exemplo Ltda',
      email: 'financeiro@exemplo.com',
    });
    await emitter.run(await upsert(buyer({})));
    expect(find).toHaveBeenCalledWith(TENANT, 'test', '11222333000181');
    expect(issuance.calls[0].request).toMatchObject({
      email: true,
      customer: {
        name: 'EMPRESA EXEMPLO',
        taxId: '11222333000181',
        email: 'financeiro@exemplo.com',
      },
    });
  });

  it('what the platform sent wins when it is usable', async () => {
    const { emitter, issuance, upsert } = withSaved({
      name: 'Outro Nome',
      email: 'saved@x.com',
    });
    await emitter.run(await upsert(buyer({ email: 'sent@x.com' })));
    expect(issuance.calls[0].request.customer).toMatchObject({
      name: 'EMPRESA EXEMPLO',
      email: 'sent@x.com',
    });
  });

  it('an obviously incomplete name is replaced by the saved one', async () => {
    const { emitter, issuance, upsert } = withSaved({
      name: 'Empresa Exemplo Ltda',
      email: null,
    });
    await emitter.run(await upsert(buyer({ name: 'E' })));
    expect(issuance.calls[0].request.customer?.name).toBe(
      'Empresa Exemplo Ltda',
    );
  });

  it('a buyer nobody knows, or a failing lookup, changes nothing and still issues', async () => {
    for (const saved of [null, 'fail'] as const) {
      const { emitter, issuance, upsert } = withSaved(saved);
      await emitter.run(await upsert(buyer({})));
      expect(issuance.calls).toHaveLength(1);
      expect(issuance.calls[0].request.email).toBe(false);
    }
  });

  it('does not look up a masked document', async () => {
    const { emitter, upsert, find } = withSaved({
      name: 'X Y Z',
      email: 'a@b.com',
    });
    await emitter.run(await upsert(buyer({ taxId: null, taxIdMasked: true })));
    expect(find).not.toHaveBeenCalled();
  });
});
