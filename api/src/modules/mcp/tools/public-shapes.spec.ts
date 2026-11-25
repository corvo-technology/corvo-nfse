import { Invoice } from '@/modules/invoice/domain/invoice';
import { toDetailedInvoice, toPublicInvoice } from './public-shapes';

function authorizedWithStaleError(): Invoice {
  const invoice = Invoice.create(
    {
      companyId: 'company-1',
      customer: null,
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-11-01'),
    },
    'tenant-1',
  );
  invoice.setReconciliationRequired('No conclusive answer');
  invoice.setDpsInfo('1', 1);
  invoice.setProcessing();
  invoice.transitionTo('authorized');
  return invoice;
}

describe('invoice shapes for agents', () => {
  it('hide a stale error on an authorized invoice', () => {
    const invoice = authorizedWithStaleError();
    expect(toDetailedInvoice(invoice).lastErrorMessage).toBeNull();
    expect(toPublicInvoice(invoice).error_message).toBeNull();
  });
});
