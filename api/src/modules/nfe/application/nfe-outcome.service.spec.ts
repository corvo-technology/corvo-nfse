import type { CustomerDirectory } from '@/modules/invoice/domain/customer-directory';
import type { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import type { NfeDocument } from '../domain/nfe-document';
import { NfeOutcomeService } from './nfe-outcome.service';
import type { NfeTransitionService } from './nfe-transition.service';

const address = {
  street: 'Rua A',
  number: '10',
  complement: null,
  district: 'Centro',
  zip: '01310100',
  cityCode: '3550308',
  city: 'São Paulo',
  state: 'SP',
};

const doc = (name = 'Maria da Silva') =>
  ({
    id: 'n1',
    tenantId: 't1',
    environment: 'test',
    toSnapshot: () => ({
      recipient: {
        taxId: '12345678909',
        name,
        email: 'maria@example.com',
        address,
        indIeDest: 9,
        stateRegistration: null,
      },
    }),
  }) as unknown as NfeDocument;

const auth = {
  accessKey: '3'.repeat(44),
  protocol: '1',
  authorizedAt: new Date(),
  cStat: '100',
  xMotivo: 'ok',
  protNFeXml: '<x/>',
};

function build(customers?: Partial<jest.Mocked<CustomerDirectory>>) {
  const transitions = {
    apply: jest.fn().mockResolvedValue({ document: doc() }),
  } as unknown as NfeTransitionService;
  const breaker = {} as FiscalPortalBreaker;
  return new NfeOutcomeService(
    transitions,
    breaker,
    customers as CustomerDirectory | undefined,
  );
}

describe('NfeOutcomeService: saving the recipient', () => {
  it('saves the recipient of an authorized NF-e in the customers list', async () => {
    const remember = jest.fn().mockResolvedValue(undefined);
    await build({ remember }).authorized(doc(), auth);
    expect(remember).toHaveBeenCalledWith(
      { tenantId: 't1', environment: 'test' },
      {
        taxId: '12345678909',
        name: 'Maria da Silva',
        email: 'maria@example.com',
        address,
        indIeDest: 9,
        stateRegistration: null,
      },
    );
  });

  it('never fails the note when the customer cannot be saved', async () => {
    const remember = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(
      build({ remember }).authorized(doc(), auth),
    ).resolves.toMatchObject({ kind: 'settled' });
  });

  it('saves nothing for a name that does not fit and works without a directory', async () => {
    const remember = jest.fn();
    await build({ remember }).authorized(doc('x'.repeat(301)), auth);
    expect(remember).not.toHaveBeenCalled();
    await expect(build().authorized(doc(), auth)).resolves.toMatchObject({
      kind: 'settled',
    });
  });
});
