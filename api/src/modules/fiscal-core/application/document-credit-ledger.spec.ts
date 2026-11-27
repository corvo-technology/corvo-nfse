import { CreditTransaction } from '@/modules/credits/domain/credit-transaction';
import type { DocumentRef } from '../domain/document-type';
import { DocumentCreditLedger } from './document-credit-ledger';

const tenantId = '11111111-1111-4111-8111-111111111111';
const documentId = '33333333-3333-4333-8333-333333333333';

const ref = (
  environment: 'test' | 'live',
  type: DocumentRef['type'] = 'nfe',
): DocumentRef => ({ type, id: documentId, tenantId, environment });

function build(price = 1) {
  const usage = {
    reserve: jest.fn().mockResolvedValue('period-1'),
    settleDocument: jest.fn().mockResolvedValue(undefined),
  };
  const credits = {
    save: jest.fn().mockResolvedValue(undefined),
    findByReservedDocument: jest.fn().mockResolvedValue(null),
    confirm: jest.fn().mockResolvedValue(undefined),
  };
  const prices = { priceOf: jest.fn().mockResolvedValue(price) };
  const ledger = new DocumentCreditLedger(
    usage as never,
    credits as never,
    prices,
  );
  const reserved = (amount = -1) =>
    credits.findByReservedDocument.mockResolvedValue(
      CreditTransaction.create({
        tenantId,
        amount,
        type: 'invoice_authorized',
        isReservation: true,
        periodId: 'period-1',
        createdAt: new Date(),
      }),
    );
  return { ledger, usage, credits, prices, reserved };
}

describe('DocumentCreditLedger', () => {
  it('writes nothing for a test document', async () => {
    const f = build();
    await f.ledger.reserve(ref('test'));
    await f.ledger.settle(ref('test'), 'processing', 'rejected');
    expect(f.usage.reserve).not.toHaveBeenCalled();
    expect(f.credits.save).not.toHaveBeenCalled();
    expect(f.usage.settleDocument).not.toHaveBeenCalled();
  });

  it('reserves the price of the type on the NF-e column', async () => {
    const f = build(2);
    await f.ledger.reserve(ref('live'));
    expect(f.prices.priceOf).toHaveBeenCalledWith('nfe');
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: -2,
        reservedNfeDocumentId: documentId,
        reservedDocumentType: 'nfe',
        isReservation: true,
        periodId: 'period-1',
      }),
      tenantId,
    );
    expect(f.credits.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ reservedInvoiceId: expect.anything() }),
      tenantId,
    );
  });

  it('reserves an NFS-e on the invoice column', async () => {
    const f = build();
    await f.ledger.reserve(ref('live', 'nfse'));
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reservedInvoiceId: documentId,
        reservedDocumentType: 'nfse',
      }),
      tenantId,
    );
  });

  it('records the avulso source when the balance paid', async () => {
    const f = build();
    f.usage.reserve.mockResolvedValue(null);
    await f.ledger.reserve(ref('live'));
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'avulso', periodId: undefined }),
      tenantId,
    );
  });

  it('confirms the reservation when authorized', async () => {
    const f = build();
    f.reserved();
    await f.ledger.settle(ref('live'), 'processing', 'authorized');
    expect(f.usage.settleDocument).toHaveBeenCalledWith(
      ref('live'),
      'authorized',
    );
    expect(f.credits.confirm).toHaveBeenCalledTimes(1);
    expect(f.credits.save).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'denied', 'discarded'])(
    'refunds the reservation on %s',
    async (to) => {
      const f = build();
      f.reserved();
      await f.ledger.settle(ref('live'), 'processing', to);
      expect(f.credits.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1, type: 'invoice_rejected' }),
        tenantId,
      );
      expect(f.credits.confirm).toHaveBeenCalledTimes(1);
    },
  );

  it('authorized, cancelling, cancelled refunds nothing', async () => {
    const f = build();
    f.reserved();
    await f.ledger.settle(ref('live'), 'authorized', 'cancelling');
    await f.ledger.settle(ref('live'), 'cancelling', 'cancelled');
    expect(f.usage.settleDocument).not.toHaveBeenCalled();
    expect(f.credits.save).not.toHaveBeenCalled();
    expect(f.credits.confirm).not.toHaveBeenCalled();
  });

  it('refunds what was reserved, not the current price', async () => {
    const f = build(3);
    f.reserved(-1);
    await f.ledger.settle(ref('live'), 'processing', 'denied');
    expect(f.credits.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1 }),
      tenantId,
    );
  });

  it('does nothing more when there is no live reservation (already refunded)', async () => {
    const f = build();
    await f.ledger.settle(ref('live'), 'rejected', 'discarded');
    expect(f.credits.save).not.toHaveBeenCalled();
    expect(f.credits.confirm).not.toHaveBeenCalled();
  });
});
