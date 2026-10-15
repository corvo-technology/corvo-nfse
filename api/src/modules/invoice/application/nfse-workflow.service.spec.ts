import { NfseWorkflowService } from './nfse-workflow.service';
import { Invoice } from '../domain/invoice';
import type { CustomerSnapshot } from '../domain/invoice';
import type { IIssuePayload } from '@/infra/external/nfse/nfse-fiscal-provider';
import { buildInvoiceState } from '../domain/invoice-state';

function buildInvoice(overrides: {
  emailRequested?: boolean;
  lastEmailStatus?: 'queued' | 'sent' | 'failed' | null;
}): Invoice {
  const state = {
    status: 'authorized' as const,
    documentsReady: true,
    emailRequested: overrides.emailRequested ?? true,
    emailStatus: overrides.lastEmailStatus ?? null,
  };
  return {
    id: 'inv-1',
    tenantId: '11111111-1111-4111-8111-111111111111',
    companyId: 'company-1',
    environment: 'test',
    status: state.status,
    documentsReadyAt: new Date(),
    emailSnapshot: { send: state.emailRequested },
    lastEmailStatus: state.emailStatus,
    state: buildInvoiceState(state),
  } as unknown as Invoice;
}

describe('NfseWorkflowService email webhooks', () => {
  const config = {
    id: 'cfg-1',
    active: true,
    url: 'https://example.com/hook',
    secret: 'secret',
  };
  let outbox: { enqueue: jest.Mock };
  let service: NfseWorkflowService;

  beforeEach(() => {
    outbox = { enqueue: jest.fn() };
    const webhooks = {
      findByTenantIdAndEvent: jest.fn().mockResolvedValue([config]),
    };
    service = new NfseWorkflowService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      webhooks as any,
      outbox as any,
      {} as any,
      {} as any,
    );
  });

  const lastData = () =>
    (
      outbox.enqueue.mock.calls[0] as [
        { payload: { data: Record<string, unknown> } },
      ]
    )[0].payload.data;

  it('email_sent carries the invoice state with emailStatus sent', async () => {
    const sentAt = new Date('2026-10-10T12:00:00Z');
    await service.emailSent(
      buildInvoice({ lastEmailStatus: 'queued' }),
      sentAt,
    );

    expect(lastData()).toMatchObject({
      invoiceId: 'inv-1',
      status: 'authorized',
      documentsStatus: 'ready',
      emailStatus: 'sent',
      stage: 'completed',
      sentAt: sentAt.toISOString(),
    });
  });

  it('email_failed carries emailStatus failed and keeps status fiscal', async () => {
    await service.emailFailed(buildInvoice({ lastEmailStatus: null }));

    expect(lastData()).toMatchObject({
      status: 'authorized',
      emailStatus: 'failed',
      stage: 'completed',
    });
  });
});

describe('NfseWorkflowService payload — tomador opcional', () => {
  const company = {
    id: 'company-1',
    taxId: '11222333000181',
    legalName: 'Empresa Teste',
    municipalReg: '123',
    municipalityCode: '3550308',
  };
  const fakes = {
    invoices: { findByIdAndTenantId: jest.fn(), save: jest.fn() },
    sequences: {
      reserveNext: jest.fn().mockResolvedValue({ series: '1', number: 7 }),
    },
    companies: { findById: jest.fn() },
    profiles: { findEffective: jest.fn() },
  };
  let service: NfseWorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    fakes.companies.findById.mockResolvedValue(company);
    fakes.sequences.reserveNext.mockResolvedValue({ series: '1', number: 7 });
    fakes.profiles.findEffective.mockResolvedValue({
      taxRegime: 'MEI',
      specialTaxRegime: null,
    });
    service = new NfseWorkflowService(
      fakes.invoices as any,
      fakes.sequences,
      fakes.companies as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      fakes.profiles as any,
    );
  });

  function createInvoice(customerSnapshot: CustomerSnapshot | null): Invoice {
    return Invoice.create(
      {
        companyId: 'company-1',
        customer: customerSnapshot,
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-10-13'),
      },
      'tenant-1',
    );
  }

  const callPayload = (invoice: Invoice) =>
    (
      service as unknown as {
        payload: (i: Invoice) => Promise<IIssuePayload>;
      }
    ).payload(invoice);

  it('omits tomador when the invoice has no customer snapshot', async () => {
    const payload = await callPayload(createInvoice(null));

    expect(payload).not.toHaveProperty('tomador');
    expect(payload.servico.cTribNac).toBe('010101');
    expect(payload.valores.vServ).toBe(100);
  });

  it('builds tomador from the customer snapshot when present', async () => {
    const payload = await callPayload(
      createInvoice({ taxId: '52998224725', name: 'Ana' }),
    );

    expect(payload.tomador).toEqual({
      documento: { CPF: '52998224725' },
      nome: 'Ana',
    });
  });

  it('builds CNPJ tomador for a business customer', async () => {
    const payload = await callPayload(
      createInvoice({ taxId: '11222333000181', name: 'Empresa' }),
    );

    expect(payload.tomador?.documento).toEqual({ CNPJ: '11222333000181' });
  });

  it('omits tomador when the customer has no taxId', async () => {
    const payload = await callPayload(
      createInvoice({ name: 'Ana', email: 'ana@example.com' }),
    );

    expect(payload).not.toHaveProperty('tomador');
  });
});
