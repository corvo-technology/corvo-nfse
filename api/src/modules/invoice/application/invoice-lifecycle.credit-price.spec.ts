import { Invoice } from '../domain/invoice';
import { InvoiceEvent } from '../domain/invoice-event';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { CreditTransaction } from '@/modules/credits/domain/credit-transaction';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';

const liveInvoice = () =>
  Invoice.create(
    {
      companyId,
      environment: 'live',
      customer: { taxId: '52998224725', name: 'Cliente' },
      service: {
        description: 'Servico',
        code: '060101',
        municipalityCode: '3550308',
      },
      amount: 50,
      competenceDate: new Date('2026-10-13'),
    },
    tenantId,
  );

function build(priceOf?: jest.Mock) {
  const credits = {
    save: jest.fn().mockResolvedValue(undefined),
    findByReservedInvoiceId: jest.fn().mockResolvedValue(null),
    confirm: jest.fn().mockResolvedValue(undefined),
  };
  const invoices = {
    findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    findByIdAndTenantId: jest.fn().mockResolvedValue({ status: 'processing' }),
    insert: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoiceLifecycleService(
    { execute: <T>(work: () => Promise<T>) => work() },
    { delete: jest.fn() } as never,
    {
      reserve: jest.fn().mockResolvedValue('period-1'),
      settle: jest.fn(),
    } as never,
    { locked: <T>(_t: string, work: () => Promise<T>) => work() } as never,
    { enqueue: jest.fn().mockResolvedValue(true) } as never,
    invoices as never,
    { save: jest.fn() } as never,
    credits as never,
    { publishBestEffort: jest.fn() } as never,
    undefined,
    undefined,
    priceOf ? { priceOf } : undefined,
  );
  return { service, credits, invoices };
}

describe('InvoiceLifecycleService credit price', () => {
  it('reserves the price read for nfse and records the document type', async () => {
    const priceOf = jest.fn().mockResolvedValue(2);
    const f = build(priceOf);
    const invoice = liveInvoice();
    await f.service.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    expect(priceOf).toHaveBeenCalledWith('nfse');
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -2, reservedDocumentType: 'nfse' }),
      tenantId,
    );
  });

  it('refunds what was reserved, not the current price', async () => {
    const f = build(jest.fn().mockResolvedValue(5));
    const invoice = liveInvoice();
    f.credits.findByReservedInvoiceId.mockResolvedValue(
      CreditTransaction.create({
        tenantId,
        amount: -2,
        type: 'invoice_authorized',
        isReservation: true,
        periodId: 'period-1',
        createdAt: new Date(),
      }),
    );
    invoice.transitionTo('processing');
    invoice.transitionTo('rejected');
    await f.service.transition(
      invoice,
      InvoiceEvent.create(invoice.id, 'processing', 'rejected'),
    );
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2, type: 'invoice_rejected' }),
      tenantId,
    );
  });

  it('keeps reserving 1 credit when no price reader is wired', async () => {
    const f = build();
    const invoice = liveInvoice();
    await f.service.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -1 }),
      tenantId,
    );
  });
});
