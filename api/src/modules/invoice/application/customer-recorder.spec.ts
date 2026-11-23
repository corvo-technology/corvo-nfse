import { Invoice } from '../domain/invoice';
import { CustomerRecorder } from './customer-recorder';

const TENANT = '01927de2-1234-7890-abcd-ef0123456789';

const invoiceFor = (
  customer: { taxId?: string; name: string; email?: string } | null,
  environment: 'test' | 'live' = 'live',
) =>
  Invoice.create(
    {
      environment,
      companyId: '01927de2-aaaa-7890-abcd-ef0123456789',
      customer,
      service: {
        description: 'Consultoria',
        code: '010601',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-11-10'),
    },
    TENANT,
  );

describe('CustomerRecorder', () => {
  const directory = { remember: jest.fn() };
  const recorder = new CustomerRecorder(directory as never);
  beforeEach(() => {
    jest.clearAllMocks();
    directory.remember.mockResolvedValue(undefined);
  });

  it('remembers the customer of the invoice in its workspace and environment', async () => {
    await recorder.rememberFrom(
      invoiceFor({
        taxId: '11222333000181',
        name: ' Acme Ltda ',
        email: 'financeiro@acme.test',
      }),
    );
    expect(directory.remember).toHaveBeenCalledWith(
      { tenantId: TENANT, environment: 'live' },
      {
        taxId: '11222333000181',
        name: 'Acme Ltda',
        email: 'financeiro@acme.test',
      },
    );
  });

  it('keeps test and live apart', async () => {
    await recorder.rememberFrom(
      invoiceFor({ taxId: '52998224725', name: 'Maria' }, 'test'),
    );
    expect(directory.remember).toHaveBeenCalledWith(
      { tenantId: TENANT, environment: 'test' },
      { taxId: '52998224725', name: 'Maria', email: null },
    );
  });

  it.each([
    ['an invoice without tomador', null],
    ['a customer without document', { name: 'Maria' }],
    [
      'the placeholder name of a request without name',
      { taxId: '52998224725', name: 'Consumidor' },
    ],
    [
      'a name longer than the DPS accepts',
      { taxId: '52998224725', name: 'x'.repeat(301) },
    ],
  ])('does not remember %s', async (_case, customer) => {
    await recorder.rememberFrom(invoiceFor(customer));
    expect(directory.remember).not.toHaveBeenCalled();
  });

  it('never fails the emission when the directory fails', async () => {
    directory.remember.mockRejectedValue(new Error('db down'));
    await expect(
      recorder.rememberFrom(
        invoiceFor({ taxId: '52998224725', name: 'Maria' }),
      ),
    ).resolves.toBeUndefined();
  });
});
