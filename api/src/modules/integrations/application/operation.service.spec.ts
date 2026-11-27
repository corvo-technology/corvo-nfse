import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OperationService } from './operation.service';
import {
  MemoryEvents,
  MemoryOperations,
  MemoryRules,
} from '../testing/memory-repositories';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import type { OperationEmitter } from './operation-emitter.service';
import type { NormalizedOperation } from '../domain/connector';

const TENANT = '11111111-1111-4111-8111-111111111111';
const normalized: NormalizedOperation = {
  operationKey: 'charge:1',
  commercialState: 'paid',
  externalRefs: {},
  occurredAt: new Date(),
  paidAt: new Date(),
  currency: 'BRL',
  amountCents: 100,
  discountCents: 0,
  customer: { name: 'M', email: null, taxId: null, taxIdMasked: true },
  items: [],
  sellerIssuesInvoice: true,
};

function setup() {
  const operations = new MemoryOperations();
  const emitter = {
    run: jest.fn().mockResolvedValue({ state: 'processed' }),
  } as unknown as OperationEmitter & { run: jest.Mock };
  const events = new MemoryEvents();
  const rules = new MemoryRules();
  const audit = new FakeAccountAudit();
  return {
    service: new OperationService(operations, emitter, events, rules, audit),
    operations,
    emitter,
    events,
    rules,
    audit,
  };
}
const seed = (operations: MemoryOperations) =>
  operations.upsertFromNormalized({
    tenantId: TENANT,
    connectionId: 'c1',
    provider: 'p',
    environment: 'test',
    externalAccountId: 'a',
    normalized,
  });

describe('OperationService', () => {
  it('completeCustomer stores the customer, clears the pendency and keeps digits only', async () => {
    const { service, operations } = setup();
    const op = await seed(operations);
    const updated = await service.completeCustomer(TENANT, op.id, {
      name: 'Maria',
      taxId: '529.982.247-25',
      email: 'm@x.com',
    });
    expect(updated.snapshot.customer).toEqual({
      name: 'Maria',
      email: 'm@x.com',
      taxId: '52998224725',
      taxIdMasked: false,
    });
    expect(updated.fiscalStatus).toBe('none');
  });
  it('completeCustomer keeps the name and e-mail the platform sent when only the document is given', async () => {
    const { service, operations } = setup();
    const op = await operations.upsertFromNormalized({
      tenantId: TENANT,
      connectionId: 'c1',
      provider: 'p',
      environment: 'test',
      externalAccountId: 'a2',
      normalized: {
        ...normalized,
        operationKey: 'charge:2',
        customer: {
          name: 'Maria da Silva',
          email: 'maria@x.com',
          taxId: null,
          taxIdMasked: true,
        },
      },
    });
    const updated = await service.completeCustomer(TENANT, op.id, {
      taxId: '52998224725',
    });
    expect(updated.snapshot.customer).toEqual({
      name: 'Maria da Silva',
      email: 'maria@x.com',
      taxId: '52998224725',
      taxIdMasked: false,
    });
  });
  it('completeCustomer refuses an invalid CPF/CNPJ', async () => {
    const { service, operations } = setup();
    const op = await seed(operations);
    await expect(
      service.completeCustomer(TENANT, op.id, { taxId: '111.111.111-11' }),
    ).rejects.toThrow(BadRequestException);
  });
  it('completeCustomer is refused once the emission request is frozen', async () => {
    const { service, operations } = setup();
    const op = await seed(operations);
    await operations.freezeEmission(op.id, TENANT, {
      ruleId: 'r',
      request: {},
      requestHash: 'h',
      idempotencyKey: 'k',
    });
    await expect(
      service.completeCustomer(TENANT, op.id, { taxId: '52998224725' }),
    ).rejects.toThrow(ConflictException);
  });
  it('unknown operation or another tenant is not found', async () => {
    const { service, operations } = setup();
    const op = await seed(operations);
    await expect(
      service.completeCustomer(TENANT, 'missing', { taxId: '52998224725' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.retry('22222222-2222-4222-8222-222222222222', op.id),
    ).rejects.toThrow(NotFoundException);
  });
  it('retry runs the emitter for an operation without an invoice', async () => {
    const { service, operations, emitter } = setup();
    const op = await seed(operations);
    await service.retry(TENANT, op.id);
    expect(emitter.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: op.id }),
    );
  });
  it('retry runs again for an invoice whose cancellation could not be requested', async () => {
    const { service, operations, emitter } = setup();
    const op = await seed(operations);
    await operations.setFiscal(
      op.id,
      TENANT,
      'needs_attention',
      'cancel_failed',
      'inv1',
    );
    await service.retry(TENANT, op.id);
    expect(emitter.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: op.id }),
    );
  });
  it('retry is refused when the invoice already exists', async () => {
    const { service, operations, emitter } = setup();
    const op = await seed(operations);
    await operations.setFiscal(op.id, TENANT, 'submitted', null, 'inv1');
    await expect(service.retry(TENANT, op.id)).rejects.toThrow(
      ConflictException,
    );
    expect(emitter.run).not.toHaveBeenCalled();
  });

  describe('resolve', () => {
    const waiting = async (operations: MemoryOperations) => {
      const op = await seed(operations);
      await operations.setFiscal(
        op.id,
        TENANT,
        'needs_attention',
        'customer_tax_id_missing',
      );
      return op;
    };
    it('stores what the client typed, then asks the emitter once', async () => {
      const { service, operations, emitter, audit } = setup();
      const op = await waiting(operations);
      const { outcome } = await service.resolve(TENANT, op.id, {
        customer: {
          name: 'Empresa X',
          taxId: '11.222.333/0001-81',
          address: { zip: '01001000', city: 'São Paulo', state: 'SP' },
        },
        service: { code: '010101', description: 'Consultoria' },
        sendEmail: false,
      });
      expect(outcome).toEqual({ state: 'processed' });
      expect(emitter.run).toHaveBeenCalledTimes(1);
      const stored = (await operations.findById(op.id, TENANT))!.snapshot;
      expect(stored.customer).toMatchObject({
        taxId: '11222333000181',
        taxIdMasked: false,
        address: { zip: '01001000', city: 'São Paulo', state: 'SP' },
      });
      expect(stored.serviceOverride).toEqual({
        code: '010101',
        description: 'Consultoria',
      });
      expect(stored.sendEmailOverride).toBe(false);
      expect(audit.events.map((e) => e.action)).toEqual([
        'integration.sale_resolved',
      ]);
      expect(JSON.stringify(audit.events)).not.toContain('11222333000181');
    });
    it('refuses an invalid document and does not touch the sale', async () => {
      const { service, operations, emitter } = setup();
      const op = await waiting(operations);
      await expect(
        service.resolve(TENANT, op.id, { customer: { taxId: '111' } }),
      ).rejects.toThrow(BadRequestException);
      expect(emitter.run).not.toHaveBeenCalled();
    });
    it('refuses a sale that already has its invoice (never issues twice)', async () => {
      const { service, operations, emitter } = setup();
      const op = await waiting(operations);
      await operations.setFiscal(op.id, TENANT, 'submitted', null, 'inv1');
      await expect(
        service.resolve(TENANT, op.id, { customer: { taxId: '52998224725' } }),
      ).rejects.toThrow(ConflictException);
      expect(emitter.run).not.toHaveBeenCalled();
    });
    it('refuses new data once the request is frozen', async () => {
      const { service, operations } = setup();
      const op = await waiting(operations);
      await operations.freezeEmission(op.id, TENANT, {
        ruleId: 'r',
        request: {},
        requestHash: 'h',
        idempotencyKey: 'k',
      });
      await expect(
        service.resolve(TENANT, op.id, { customer: { taxId: '52998224725' } }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('ignore', () => {
    it('blocks the sale, settles its notices and audits the reason', async () => {
      const { service, operations, audit } = setup();
      const op = await seed(operations);
      await operations.setFiscal(op.id, TENANT, 'needs_attention', 'no_rule');
      const done = await service.ignore(TENANT, op.id, 'Venda de teste');
      expect(done.fiscalStatus).toBe('blocked');
      expect(done.blockReason).toBe('ignored_by_user');
      expect(audit.events[0]).toMatchObject({
        action: 'integration.sale_ignored',
        metadata: { reason: 'Venda de teste' },
      });
    });
    it('cannot ignore a sale that has an invoice', async () => {
      const { service, operations } = setup();
      const op = await seed(operations);
      await operations.setFiscal(op.id, TENANT, 'submitted', null, 'inv1');
      await expect(service.ignore(TENANT, op.id, 'x')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  it('lists the sales waiting for the client of one environment', async () => {
    const { service, operations } = setup();
    const op = await seed(operations);
    await operations.setFiscal(op.id, TENANT, 'needs_attention', 'no_rule');
    expect(await service.listNeedingAttention(TENANT, 'test', 10)).toHaveLength(
      1,
    );
    expect(await service.listNeedingAttention(TENANT, 'live', 10)).toHaveLength(
      0,
    );
  });
});
