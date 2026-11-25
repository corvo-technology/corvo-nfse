import type { ConfigService } from '@nestjs/config';
import { Invoice } from '../domain/invoice';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import type { IFiscalSnapshotRepository } from '../domain/fiscal/fiscal-snapshot.repository';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import { NfseWorkflowService } from './nfse-workflow.service';
import {
  NumberingCheckUnavailableError,
  NumberingNeedsConfirmationError,
} from './dps-numbering.service';

jest.mock('./fiscal/fiscal.metrics');

const tenantId = '11111111-1111-4111-8111-111111111111';
const company = {
  id: 'company-1',
  taxId: '11222333000181',
  legalName: 'Empresa Teste',
  municipalReg: '123',
  municipalRegForDps: '123',
  municipalityCode: '3550308',
};

describe('NfseWorkflowService first-emission numbering check', () => {
  const provider = { issue: jest.fn(), queryByDps: jest.fn() };
  const numbering = { skipUsedNumbers: jest.fn() };
  const fakes = {
    invoices: {
      findByIdAndTenantId: jest.fn(),
      save: jest.fn(),
      saveDpsInfo: jest.fn(),
    },
    sequences: { reserveNext: jest.fn() },
    companies: { findById: jest.fn() },
    certificates: { decryptCredentials: jest.fn() },
    providers: { resolve: () => provider, isSimulated: () => false },
    lifecycle: { transition: jest.fn() },
    queues: { add: jest.fn() },
    webhooks: { findByTenantIdAndEvent: jest.fn() },
    outbox: { enqueue: jest.fn() },
    documentStorage: { saveXml: jest.fn() },
    profiles: { findEffective: jest.fn() },
    fiscalSnapshots: { findByInvoiceId: jest.fn() },
    config: { getOrThrow: jest.fn(), get: jest.fn() },
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
    fakes.certificates.decryptCredentials.mockResolvedValue({
      pfxBuffer: Buffer.alloc(0),
      password: '',
    });
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(null);
    fakes.config.getOrThrow.mockReturnValue({ dpsLayout: 'rtc-v1.01' });
    fakes.webhooks.findByTenantIdAndEvent.mockResolvedValue([]);
    fakes.lifecycle.transition.mockResolvedValue(true);
    service = new NfseWorkflowService(
      fakes.invoices as never,
      fakes.sequences as never,
      fakes.companies as never,
      fakes.certificates as never,
      fakes.providers as never,
      fakes.lifecycle as never,
      fakes.queues as never,
      new InvoiceWebhookPublisher(
        fakes.webhooks as never,
        fakes.outbox as never,
      ),
      fakes.documentStorage as never,
      fakes.profiles as never,
      fakes.fiscalSnapshots as unknown as IFiscalSnapshotRepository,
      new DpsBuilder(),
      fakes.config as unknown as ConfigService,
      undefined,
      numbering as never,
    );
  });

  const queued = (): Invoice => {
    const invoice = Invoice.create(
      {
        companyId: company.id,
        customer: null,
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-11-01'),
        environment: 'live',
      },
      tenantId,
    );
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    return invoice;
  };
  const run = (invoice: Invoice) =>
    service.process({
      invoiceId: invoice.id,
      tenantId,
      companyId: company.id,
    });

  it('rejects before reserving a DPS number when every number asked is used, so the credit comes back', async () => {
    const invoice = queued();
    numbering.skipUsedNumbers.mockRejectedValue(
      new NumberingNeedsConfirmationError({
        series: '1',
        nextNumber: 1,
        usedNumbers: [1, 2, 3],
        suggestedNext: 4,
        moreMayBeUsed: false,
      }),
    );

    await run(invoice);

    expect(fakes.sequences.reserveNext).not.toHaveBeenCalled();
    expect(provider.issue).not.toHaveBeenCalled();
    const snapshot = invoice.toSnapshot();
    expect(snapshot.status).toBe('rejected');
    expect(snapshot.lastErrorCode).toBe('DPS_NUMBERING_NEEDS_CONFIRMATION');
    expect(snapshot.dpsNumber).toBeFalsy();
    expect(snapshot.lastErrorMessage).toContain(
      'Os números de nota 1 a 3 já foram usados',
    );
    // The transition to rejected is what releases the reserved credit.
    expect(fakes.lifecycle.transition).toHaveBeenCalled();
  });

  it('when the portal does not answer the job fails to be retried, with no number reserved', async () => {
    const invoice = queued();
    numbering.skipUsedNumbers.mockRejectedValue(
      new NumberingCheckUnavailableError(new Error('timeout')),
    );

    await expect(run(invoice)).rejects.toBeInstanceOf(
      NumberingCheckUnavailableError,
    );

    expect(fakes.sequences.reserveNext).not.toHaveBeenCalled();
    expect(invoice.status).toBe('queued');
  });

  it('skips used numbers, emits with the next free one and writes it on the timeline', async () => {
    const invoice = queued();
    numbering.skipUsedNumbers.mockResolvedValue({
      from: 1,
      to: 3,
      nextFree: 4,
    });
    fakes.sequences.reserveNext.mockResolvedValue({ series: '1', number: 4 });
    provider.issue.mockResolvedValue({
      success: false,
      requiresReconciliation: true,
      errorMessage: 'pending',
    });

    await run(invoice);

    expect(invoice.toSnapshot().dpsNumber).toBe(4);
    const events = fakes.lifecycle.transition.mock.calls.map(
      ([, event]: [unknown, { toSnapshot: () => { reason: string } }]) =>
        event.toSnapshot().reason,
    );
    expect(events).toContain(
      'Starting fiscal emission. Os números 1 a 3 já estavam usados no governo; a nota saiu com o número 4.',
    );
  });

  it('goes on to reserve the number when the check passes', async () => {
    const invoice = queued();
    numbering.skipUsedNumbers.mockResolvedValue(undefined);
    provider.issue.mockResolvedValue({
      success: false,
      requiresReconciliation: true,
      errorMessage: 'pending',
    });

    await run(invoice);

    expect(numbering.skipUsedNumbers).toHaveBeenCalledWith(
      company.id,
      tenantId,
      'live',
    );
    expect(fakes.sequences.reserveNext).toHaveBeenCalledTimes(1);
  });
});
