import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Invoice } from '../domain/invoice';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import type { IFiscalSnapshotRepository } from '../domain/fiscal/fiscal-snapshot.repository';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import { PortalUnavailableError } from './fiscal-portal-breaker';
import {
  DISCARDED_ERROR_CODE,
  NfseWorkflowService,
  type FiscalJobData,
} from './nfse-workflow.service';

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
const authorized = {
  accessKey: '43144000000000000000000000000000000000000000000000',
  nfseNumber: 7,
  xmlAuthorized: '<NFSe/>',
};

const realXml = readFileSync(
  join(__dirname, '../infra/danfse/__fixtures__/authorized-nfse.xml'),
  'utf8',
);
const PORTAL_TIME = new Date('2026-10-16T20:33:15-03:00');

describe('NfseWorkflowService when the fiscal portal is down', () => {
  const provider = { issue: jest.fn(), queryByDps: jest.fn() };
  const breaker = {
    settings: {
      breakerThreshold: 5,
      breakerCooldownMs: 300_000,
      uncertainMaxHours: 6,
    },
    assertAvailable: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  };
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
      breaker as never,
    );
  });

  const invoiceIn = (
    status: 'queued' | 'reconciliation_required' | 'manual_review',
  ): Invoice => {
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
    if (status !== 'queued') {
      invoice.setDpsInfo('1', 7);
      invoice.setProcessing();
      invoice.transitionTo('reconciliation_required');
    }
    if (status === 'manual_review') invoice.transitionTo('manual_review');
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    return invoice;
  };
  const run = (invoice: Invoice, extra: Partial<FiscalJobData> = {}) =>
    service.process({
      invoiceId: invoice.id,
      tenantId,
      companyId: company.id,
      ...extra,
    });
  const reconciliationJobs = (): unknown[][] =>
    (fakes.queues.add.mock.calls as unknown[][]).filter(
      ([queue]) => queue === 'nfse-reconciliation',
    );

  it('does not call the portal while it is paused: the job waits', async () => {
    const invoice = invoiceIn('queued');
    breaker.assertAvailable.mockRejectedValueOnce(
      new PortalUnavailableError(new Date()),
    );

    await expect(run(invoice)).rejects.toBeInstanceOf(PortalUnavailableError);

    expect(provider.issue).not.toHaveBeenCalled();
    expect(invoice.status).toBe('queued');
  });

  it('a network error counts against the portal and schedules exactly one follow-up', async () => {
    const invoice = invoiceIn('queued');
    provider.issue.mockRejectedValue(new Error('ECONNRESET'));

    await expect(run(invoice)).resolves.toBeUndefined();

    expect(breaker.recordFailure).toHaveBeenCalledWith('live');
    expect(invoice.status).toBe('reconciliation_required');
    expect(reconciliationJobs()).toHaveLength(1);
    expect(reconciliationJobs()[0][2]).toMatchObject({
      attemptCount: 1,
      uncertainSince: expect.any(String),
    });
  });

  it('keeps the first uncertain time across follow-ups', async () => {
    const invoice = invoiceIn('reconciliation_required');
    provider.issue.mockResolvedValue({
      success: false,
      requiresReconciliation: true,
      errorMessage: 'still pending',
    });
    const since = new Date(Date.now() - 60 * 60_000).toISOString();

    await run(invoice, { attemptCount: 2, uncertainSince: since });

    expect(reconciliationJobs()[0][2]).toMatchObject({
      attemptCount: 3,
      uncertainSince: since,
    });
  });

  it('an answer from the portal closes the breaker', async () => {
    const invoice = invoiceIn('queued');
    provider.issue.mockResolvedValue({
      success: true,
      requiresReconciliation: false,
      ...authorized,
    });

    await run(invoice);

    expect(breaker.recordSuccess).toHaveBeenCalledWith('live');
    expect(invoice.status).toBe('authorized');
  });

  it('sends the invoice to manual review after the ceiling without calling the portal', async () => {
    const invoice = invoiceIn('reconciliation_required');
    const since = new Date(Date.now() - 7 * 3_600_000).toISOString();

    await run(invoice, { uncertainSince: since });

    expect(invoice.status).toBe('manual_review');
    expect(invoice.toSnapshot().lastErrorMessage).toContain('more than 6h');
    expect(provider.issue).not.toHaveBeenCalled();
    expect(fakes.outbox.enqueue).not.toHaveBeenCalled(); // no webhook configured
  });

  describe('discard from manual review', () => {
    const discard = (invoice: Invoice) => run(invoice, { review: 'discard' });

    it('rejects only when the portal confirms the DPS was never registered', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({ status: 'not_found' });

      await discard(invoice);

      expect(provider.queryByDps).toHaveBeenCalledWith(
        invoice.toSnapshot().dpsId,
        expect.anything(),
      );
      expect(invoice.status).toBe('rejected');
      expect(invoice.toSnapshot().lastErrorCode).toBe(DISCARDED_ERROR_CODE);
      expect(provider.issue).not.toHaveBeenCalled();
    });

    it('authorizing from a discard clears the old error and uses the portal time', async () => {
      const invoice = invoiceIn('manual_review');
      invoice.setReconciliationRequired('No conclusive answer');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
        xmlAuthorized: realXml,
      });

      await discard(invoice);

      const snapshot = invoice.toSnapshot();
      expect(snapshot.status).toBe('authorized');
      expect(snapshot.lastErrorMessage).toBeNull();
      expect(snapshot.authorizedAt).toEqual(PORTAL_TIME);
      expect(snapshot.issuedAt).toEqual(PORTAL_TIME);
    });

    it('authorizes instead when the NFS-e already exists on the portal', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
      });

      await discard(invoice);

      expect(invoice.status).toBe('authorized');
      expect(invoice.toSnapshot().accessKey).toBe(authorized.accessKey);
    });

    it('stays in manual review with the reason when the portal does not answer', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockRejectedValue(new Error('timeout'));

      await discard(invoice);

      expect(invoice.status).toBe('manual_review');
      expect(invoice.toSnapshot().lastErrorMessage).toBe(
        'Discard not confirmed: timeout',
      );
      expect(fakes.invoices.save).toHaveBeenCalledWith(invoice, tenantId);
      expect(breaker.recordFailure).toHaveBeenCalledWith('live');
    });

    it('ignores an invoice that left manual review meanwhile', async () => {
      const invoice = invoiceIn('reconciliation_required');

      await discard(invoice);

      expect(provider.queryByDps).not.toHaveBeenCalled();
      expect(invoice.status).toBe('reconciliation_required');
    });
  });

  describe('manual review sweep (query only)', () => {
    const sweep = (invoice: Invoice) => run(invoice, { review: 'sweep' });
    let info: jest.SpyInstance;
    let warn: jest.SpyInstance;
    beforeEach(() => {
      info = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => {
      info.mockRestore();
      warn.mockRestore();
    });

    it('clears the old error and uses the portal processing time (dhProc)', async () => {
      const invoice = invoiceIn('manual_review');
      invoice.setReconciliationRequired('No conclusive answer');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
        xmlAuthorized: realXml,
      });

      await sweep(invoice);

      const snapshot = invoice.toSnapshot();
      expect(snapshot.status).toBe('authorized');
      expect(snapshot.lastErrorMessage).toBeNull();
      expect(snapshot.lastErrorCode).toBeNull();
      expect(snapshot.authorizedAt).toEqual(PORTAL_TIME);
      expect(snapshot.issuedAt).toEqual(PORTAL_TIME);
    });

    it('falls back to now when the XML has no readable dhProc', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
      });

      await sweep(invoice);

      expect(invoice.toSnapshot().authorizedAt!.getTime()).toBeGreaterThan(
        Date.now() - 5000,
      );
    });

    it('authorizes when the portal already has the DPS, without sending anything', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
      });

      await sweep(invoice);

      expect(invoice.status).toBe('authorized');
      expect(invoice.toSnapshot().accessKey).toBe(authorized.accessKey);
      expect(fakes.documentStorage.saveXml).toHaveBeenCalled();
      expect(fakes.queues.add).toHaveBeenCalledWith(
        'nfse-doc-prep',
        'prepare',
        expect.anything(),
        expect.anything(),
      );
      expect(provider.issue).not.toHaveBeenCalled();
    });

    it('leaves the invoice untouched when the portal says not found', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({ status: 'not_found' });

      await sweep(invoice);

      expect(invoice.status).toBe('manual_review');
      expect(fakes.lifecycle.transition).not.toHaveBeenCalled();
      expect(fakes.invoices.save).not.toHaveBeenCalled();
      expect(fakes.queues.add).not.toHaveBeenCalled();
      expect(provider.issue).not.toHaveBeenCalled();
    });

    it.each([
      ['timeout', new Error('Request timed out after 60000ms'), 'timeout'],
      ['error', new Error('socket hang up'), 'error'],
    ])('leaves it untouched on %s and logs the kind', async (_n, err, kind) => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockRejectedValue(err);

      await sweep(invoice);

      expect(invoice.status).toBe('manual_review');
      expect(fakes.lifecycle.transition).not.toHaveBeenCalled();
      expect(fakes.invoices.save).not.toHaveBeenCalled();
      expect(provider.issue).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: invoice.id,
          dpsId: invoice.toSnapshot().dpsId,
          outcome: kind,
          source: 'manual_review_sweep',
        }),
        'Fiscal reconciliation attempt',
      );
    });

    it('logs the authorized outcome without XML', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
      });

      await sweep(invoice);

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'authorized',
          invoiceId: invoice.id,
        }),
        'Fiscal reconciliation attempt',
      );
      expect(
        JSON.stringify([...info.mock.calls, ...warn.mock.calls]),
      ).not.toContain('<');
    });

    it('does nothing for an invoice that left manual review', async () => {
      const invoice = invoiceIn('reconciliation_required');

      await sweep(invoice);

      expect(provider.queryByDps).not.toHaveBeenCalled();
    });
  });

  it('logs each reconciliation attempt with the next delay and no XML', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const invoice = invoiceIn('reconciliation_required');
    provider.issue.mockRejectedValue(
      new Error('Request timed out <Envelope>secret</Envelope>'),
    );

    await run(invoice, {
      attemptCount: 2,
      uncertainSince: new Date().toISOString(),
    });

    const [fields] = warn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({
      invoiceId: invoice.id,
      outcome: 'timeout',
      attempt: 2,
      nextDelayMs: 480000,
    });
    expect(JSON.stringify(fields)).not.toContain('<');
    warn.mockRestore();
  });
});
