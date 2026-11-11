import { Invoice } from './invoice';

function authorized(): Invoice {
  const invoice = Invoice.create({
    companyId: 'c1',
    tenantId: 't1',
    environment: 'live',
    customer: null,
    service: { description: 'x', code: '010101', municipalityCode: '3550308' },
    amount: 10,
    competenceDate: new Date('2026-04-01'),
  } as never);
  invoice.setProcessing();
  invoice.setAuthorized('K'.repeat(50), 7);
  invoice.transitionTo('authorized');
  return invoice;
}

describe('Invoice.markCancelledOnPortal', () => {
  it('moves an authorized invoice to cancelled and keeps the portal reason', () => {
    const invoice = authorized();
    const event = invoice.markCancelledOnPortal('Erro de digitação');
    expect(invoice.status).toBe('cancelled');
    expect(invoice.cancelledAt).not.toBeNull();
    expect(invoice.cancellationReason?.description).toContain(
      'Erro de digitação',
    );
    expect(event.toSnapshot()).toMatchObject({
      fromStatus: 'authorized',
      toStatus: 'cancelled',
    });
  });

  it('refuses any other status, so nothing is ever brought back or cancelled twice', () => {
    const invoice = authorized();
    invoice.markCancelledOnPortal(null);
    expect(() => invoice.markCancelledOnPortal(null)).toThrow();
  });
});
