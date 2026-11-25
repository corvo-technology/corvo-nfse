import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { Invoice } from '../domain/invoice';
import { InvoiceService } from './invoice.service';
import type { CreateInvoiceDto } from '../http/invoice.dto';

const tenantId = '11111111-1111-4111-8111-111111111111';

function invoice(withCustomer = true): Invoice {
  return Invoice.create(
    {
      companyId: 'company-1',
      environment: 'test',
      customer: withCustomer
        ? { taxId: VALID_CNPJ, name: 'Cliente' }
        : undefined,
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 250,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
}

function build(prepared: unknown) {
  const audit = new FakeAccountAudit();
  const lifecycle = { submit: jest.fn().mockResolvedValue(undefined) };
  const service = new InvoiceService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    lifecycle as never,
    { getStatus: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    audit,
  );
  jest
    .spyOn(service, 'prepareEmissionInEnvironment')
    .mockResolvedValue(prepared as never);
  return { service, audit, lifecycle };
}

const dto = {} as CreateInvoiceDto;
const ready = (created: Invoice) => ({
  kind: 'ready',
  invoice: created,
  event: {},
  requestHash: 'h',
});

describe('InvoiceService.emitInEnvironment audit', () => {
  it('records invoice.issued with the customer name and amount', async () => {
    const created = invoice();
    const { service, audit } = build(ready(created));
    await service.emitInEnvironment(dto, tenantId, 'test');
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: 'invoice.issued',
      tenantId,
      environment: 'test',
      target: { type: 'invoice', id: created.id, label: 'Cliente' },
      metadata: { amount: 250 },
    });
    expect(audit.events[0].metadata).not.toHaveProperty('number');
  });

  it('labels an invoice without a customer as Consumidor', async () => {
    const { service, audit } = build(ready(invoice(false)));
    await service.emitInEnvironment(dto, tenantId, 'test');
    expect(audit.events[0].target?.label).toBe('Consumidor');
  });

  it('records invoice.substituted for the new invoice instead of invoice.issued', async () => {
    const created = invoice();
    const { service, audit } = build(ready(created));
    await service.emitInEnvironment(dto, tenantId, 'test', undefined, {
      invoiceId: 'old-invoice',
      description: 'Correção do valor informado',
    });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: 'invoice.substituted',
      target: { type: 'invoice', id: created.id },
      metadata: { substitutes_invoice_id: 'old-invoice' },
    });
  });

  it('does not record an idempotent replay', async () => {
    const { service, audit, lifecycle } = build({
      kind: 'replay',
      invoice: invoice(),
    });
    await service.emitInEnvironment(dto, tenantId, 'test', 'key-1');
    expect(lifecycle.submit).not.toHaveBeenCalled();
    expect(audit.events).toHaveLength(0);
  });

  it('records nothing when the submission fails', async () => {
    const { service, audit, lifecycle } = build(ready(invoice()));
    lifecycle.submit.mockRejectedValue(new Error('db down'));
    await expect(
      service.emitInEnvironment(dto, tenantId, 'test'),
    ).rejects.toThrow('db down');
    expect(audit.events).toHaveLength(0);
  });

  it('keeps the action when the recorder fails', async () => {
    const created = invoice();
    const { service, audit } = build(ready(created));
    jest.spyOn(audit, 'record').mockRejectedValue(new Error('boom'));
    await expect(
      service.emitInEnvironment(dto, tenantId, 'test'),
    ).resolves.toBe(created);
  });
});
