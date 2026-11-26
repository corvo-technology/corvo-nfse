import type { ConfigService } from '@nestjs/config';
import { Invoice } from '../domain/invoice';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import type { IFiscalSnapshotRepository } from '../domain/fiscal/fiscal-snapshot.repository';
import { portalNfseXml } from '../domain/fiscal/__fixtures__/portal-nfse-xml';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import { describeCause, NfseWorkflowService } from './nfse-workflow.service';
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
  const numbering = { skipUsedNumbers: jest.fn(), skipForward: jest.fn() };
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

  it('when the portal cannot run the check the note is still emitted with the next number (the government refuses a used one)', async () => {
    const invoice = queued();
    numbering.skipUsedNumbers.mockRejectedValue(
      new NumberingCheckUnavailableError(new Error('HTTP 400')),
    );
    provider.issue.mockResolvedValue({
      success: false,
      requiresReconciliation: true,
      errorMessage: 'pending',
    });

    await run(invoice);

    expect(fakes.sequences.reserveNext).toHaveBeenCalledTimes(1);
    expect(provider.issue).toHaveBeenCalledTimes(1);
    expect(invoice.toSnapshot().dpsNumber).toBe(7);
    expect(invoice.status).not.toBe('rejected');
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

  describe('a number that turns out to be used later', () => {
    const noteFor = (
      number: number,
      amount = '100.00',
      day = '2026-11-01',
    ) => ({
      success: true,
      requiresReconciliation: false,
      accessKey: '43144000000000000000000000000000000000000000000000',
      nfseNumber: number,
      xmlAuthorized: portalNfseXml({
        providerCnpj: company.taxId,
        amount,
        competenceDate: day,
        series: '1',
        number,
      }),
    });
    const timeline = (): string[] =>
      fakes.lifecycle.transition.mock.calls.map(
        ([, event]: [unknown, { toSnapshot: () => { reason: string } }]) =>
          event.toSnapshot().reason,
      );

    beforeEach(() => {
      numbering.skipUsedNumbers.mockResolvedValue(null);
      numbering.skipForward.mockResolvedValue({ from: 7, to: 7, nextFree: 8 });
    });

    it('E0014 on a DPS never sent: takes the next free number and emits the same invoice again', async () => {
      const invoice = queued();
      fakes.sequences.reserveNext
        .mockResolvedValueOnce({ series: '1', number: 7 })
        .mockResolvedValueOnce({ series: '1', number: 8 });
      provider.issue
        .mockResolvedValueOnce({
          success: false,
          requiresReconciliation: false,
          errorCode: 'DPS_NUMBER_ALREADY_USED',
          errorMessage: 'E0014',
        })
        .mockResolvedValueOnce(noteFor(8));

      await run(invoice);

      expect(numbering.skipForward).toHaveBeenCalledTimes(1);
      expect(provider.issue).toHaveBeenCalledTimes(2);
      expect(invoice.status).toBe('authorized');
      expect(invoice.toSnapshot().dpsNumber).toBe(8);
      expect(timeline()).toContain(
        'NFS-e authorized. O número 7 já estava usado no governo; a nota saiu com o número 8.',
      );
    });

    it('the portal answering with another note for our DPS also takes the next free number', async () => {
      const invoice = queued();
      fakes.sequences.reserveNext
        .mockResolvedValueOnce({ series: '1', number: 7 })
        .mockResolvedValueOnce({ series: '1', number: 8 });
      provider.issue
        .mockResolvedValueOnce(noteFor(7, '49.90', '2026-10-16'))
        .mockResolvedValueOnce(noteFor(8));

      await run(invoice);

      expect(invoice.status).toBe('authorized');
      expect(invoice.toSnapshot().dpsNumber).toBe(8);
    });

    it('Tentar de novo on manual review (DPS used by another note) emits with a new number', async () => {
      const invoice = queued();
      invoice.setDpsInfo('1', 7);
      invoice.setProcessing();
      invoice.transitionTo('reconciliation_required');
      invoice.transitionTo('manual_review');
      invoice.setRejected('DPS_NUMBER_USED_BY_OTHER_NFSE', 'outra nota');
      provider.queryByDps.mockResolvedValue({
        ...noteFor(7, '49.90', '2026-10-16'),
        status: 'authorized',
      });
      fakes.sequences.reserveNext.mockResolvedValue({ series: '1', number: 8 });
      provider.issue.mockResolvedValue(noteFor(8));

      await service.process({
        invoiceId: invoice.id,
        tenantId,
        companyId: company.id,
        review: 'renumber',
      });

      expect(invoice.status).toBe('authorized');
      expect(invoice.toSnapshot().dpsNumber).toBe(8);
    });

    it('Tentar de novo leaves the invoice in review when the portal does not confirm', async () => {
      const invoice = queued();
      invoice.setDpsInfo('1', 7);
      invoice.setProcessing();
      invoice.transitionTo('reconciliation_required');
      invoice.transitionTo('manual_review');
      invoice.setRejected('DPS_NUMBER_USED_BY_OTHER_NFSE', 'outra nota');
      provider.queryByDps.mockResolvedValue({ status: 'not_found' });

      await service.process({
        invoiceId: invoice.id,
        tenantId,
        companyId: company.id,
        review: 'renumber',
      });

      expect(provider.issue).not.toHaveBeenCalled();
      expect(invoice.status).toBe('manual_review');
    });

    it('never renumbers when the portal note is ours', async () => {
      const invoice = queued();
      provider.issue.mockResolvedValueOnce(noteFor(7));

      await run(invoice);

      expect(numbering.skipForward).not.toHaveBeenCalled();
      expect(invoice.status).toBe('authorized');
      expect(invoice.toSnapshot().dpsNumber).toBe(7);
    });

    it('gives up after 3 new numbers and rejects as before', async () => {
      const invoice = queued();
      let n = 6;
      fakes.sequences.reserveNext.mockImplementation(() =>
        Promise.resolve({ series: '1', number: ++n }),
      );
      provider.issue.mockResolvedValue({
        success: false,
        requiresReconciliation: false,
        errorCode: 'DPS_NUMBER_ALREADY_USED',
        errorMessage: 'E0014',
      });

      await run(invoice);

      expect(numbering.skipForward).toHaveBeenCalledTimes(3);
      expect(provider.issue).toHaveBeenCalledTimes(4);
      expect(invoice.status).toBe('rejected');
    });

    it('does not renumber a DPS that may already have been sent', async () => {
      const invoice = queued();
      invoice.setDpsInfo('1', 7);
      invoice.setProcessing();
      provider.issue.mockResolvedValueOnce({
        success: false,
        requiresReconciliation: false,
        errorCode: 'DPS_NUMBER_ALREADY_USED',
        errorMessage: 'E0014',
      });

      await run(invoice);

      expect(numbering.skipForward).not.toHaveBeenCalled();
      expect(invoice.status).toBe('rejected');
    });

    it('stays retryable when the portal cannot confirm the next free number', async () => {
      const invoice = queued();
      numbering.skipForward.mockRejectedValue(
        new NumberingCheckUnavailableError(new Error('timeout')),
      );
      provider.issue.mockResolvedValueOnce({
        success: false,
        requiresReconciliation: false,
        errorCode: 'DPS_NUMBER_ALREADY_USED',
        errorMessage: 'E0014',
      });

      await expect(run(invoice)).rejects.toBeInstanceOf(
        NumberingCheckUnavailableError,
      );
      expect(invoice.status).not.toBe('rejected');
    });
  });
});

describe('describeCause', () => {
  it('keeps the error kind and HTTP status, never a body', () => {
    const error = Object.assign(new Error('HTTP 403'), {
      name: 'ForbiddenError',
      status: 403,
      body: '<secret/>',
    });
    expect(describeCause(error)).toBe('ForbiddenError HTTP 403 HTTP 403');
    expect(describeCause('x')).toBe('x');
  });
});
