import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OperationService } from './operation.service';
import { MemoryOperations } from '../testing/memory-repositories';
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
  return {
    service: new OperationService(operations, emitter),
    operations,
    emitter,
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
  it('retry is refused when the invoice already exists', async () => {
    const { service, operations, emitter } = setup();
    const op = await seed(operations);
    await operations.setFiscal(op.id, TENANT, 'submitted', null, 'inv1');
    await expect(service.retry(TENANT, op.id)).rejects.toThrow(
      ConflictException,
    );
    expect(emitter.run).not.toHaveBeenCalled();
  });
});
