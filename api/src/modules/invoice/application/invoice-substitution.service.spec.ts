import { InvoiceNotSubstitutableError } from '../domain/errors';
import { Invoice } from '../domain/invoice';
import { InvoiceSubstitutionService } from './invoice-substitution.service';

const TENANT = 'tenant-1';
const original = (
  over: {
    customer?: Parameters<typeof Invoice.create>[0]['customer'];
    authorized?: boolean;
  } = {},
) => {
  const invoice = Invoice.create(
    {
      environment: 'live',
      companyId: 'company-1',
      customer:
        over.customer === undefined
          ? {
              taxId: '12345678000195',
              name: 'Cliente Teste LTDA',
              email: 'fin@cliente.test',
              address: { city: 'SIM', state: 'SS' },
            }
          : over.customer,
      service: {
        description: 'Consultoria em TI',
        code: '010601',
        municipalityCode: '3550308',
        purchaseOrder: 'PO-1',
        notes: 'Parcela 1',
      },
      amount: 1000,
      discount: 50,
      competenceDate: new Date('2026-10-13'),
      email: { send: true },
    },
    TENANT,
  );
  if (over.authorized !== false) {
    invoice.transitionTo('processing');
    invoice.setAuthorized('4'.repeat(50), 7);
    invoice.transitionTo('authorized');
  }
  return invoice;
};

describe('InvoiceSubstitutionService', () => {
  const invoices = {
    findById: jest.fn(),
    emitInEnvironment: jest.fn(),
    assertNoteMatchesEnvironment: jest.fn(),
  };
  const service = new InvoiceSubstitutionService(invoices as never);
  beforeEach(() => {
    jest.clearAllMocks();
    invoices.emitInEnvironment.mockResolvedValue('substitute');
    invoices.assertNoteMatchesEnvironment.mockResolvedValue(undefined);
  });
  const bodySent = () =>
    (invoices.emitInEnvironment.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    > & { customer?: { address?: unknown } };

  it('does not substitute a note the Sefin would refuse for its environment', async () => {
    const source = original();
    invoices.findById.mockResolvedValue(source);
    invoices.assertNoteMatchesEnvironment.mockRejectedValue(new Error('env'));
    await expect(
      service.substitute(
        source.id,
        TENANT,
        'live',
        { description: 'Descrição do serviço corrigida' },
        undefined,
      ),
    ).rejects.toThrow('env');
    expect(invoices.assertNoteMatchesEnvironment).toHaveBeenCalledWith(
      source,
      'substituir',
    );
    expect(invoices.emitInEnvironment).not.toHaveBeenCalled();
  });

  it('repeats the original and changes only what was asked', async () => {
    const source = original();
    invoices.findById.mockResolvedValue(source);

    const result = await service.substitute(
      source.id,
      TENANT,
      'live',
      {
        description: '  Descrição do serviço corrigida ',
        service: { description: 'Consultoria em TI, outubro/2026' },
        notes: '',
      },
      'key-1',
    );

    expect(result).toBe('substitute');
    expect(invoices.findById).toHaveBeenCalledWith(source.id, TENANT, 'live');
    expect(bodySent()).toMatchObject({
      companyId: 'company-1',
      customer: {
        taxId: '12345678000195',
        name: 'Cliente Teste LTDA',
        email: 'fin@cliente.test',
      },
      service: {
        description: 'Consultoria em TI, outubro/2026',
        code: '010601',
        municipalityCode: '3550308',
      },
      amount: 1000,
      discount: 50,
      competenceDate: '2026-10-13',
      purchaseOrder: 'PO-1',
      notes: '',
      options: { email: { send: true } },
    });
    // The placeholder stored when the customer has no address never goes back as an address.
    expect(bodySent().customer?.address).toBeUndefined();
    expect(invoices.emitInEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      'live',
      'key-1',
      { invoiceId: source.id, description: 'Descrição do serviço corrigida' },
    );
  });

  it('substitutes an invoice without tomador as an invoice without tomador', async () => {
    const source = original({ customer: null });
    invoices.findById.mockResolvedValue(source);
    await service.substitute(source.id, TENANT, 'live', {
      description: 'Descrição do serviço corrigida',
    });
    expect(bodySent()).not.toHaveProperty('customer');
  });

  it('repeats a customer abroad as issued, without a CPF/CNPJ or a Brazilian address', async () => {
    const foreign = {
      taxId: '12-3456789',
      country: 'US',
      postalCode: '94105',
      city: 'San Francisco',
      region: 'CA',
      street: '1 Market St',
      number: '100',
      district: 'SoMa',
    };
    const source = original({
      customer: {
        name: 'Acme Inc.',
        address: { city: 'San Francisco', state: 'EX' },
        foreign,
      },
    });
    invoices.findById.mockResolvedValue(source);
    await service.substitute(source.id, TENANT, 'live', {
      description: 'Descrição do serviço corrigida',
    });
    const customer = bodySent().customer as Record<string, unknown>;
    expect(customer).toMatchObject({ name: 'Acme Inc.', foreign });
    expect(customer.taxId).toBeUndefined();
    expect(customer.address).toBeUndefined();
  });

  it('refuses an invoice that is not authorized and issues nothing', async () => {
    const source = original({ authorized: false });
    invoices.findById.mockResolvedValue(source);
    await expect(
      service.substitute(source.id, TENANT, 'live', {
        description: 'Descrição do serviço corrigida',
      }),
    ).rejects.toBeInstanceOf(InvoiceNotSubstitutableError);
    expect(invoices.emitInEnvironment).not.toHaveBeenCalled();
  });
});
