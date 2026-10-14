import { NfseWorkflowService } from './nfse-workflow.service';
import type { Invoice } from '../domain/invoice';
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
