import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { HttpStatusError, NetworkError, TimeoutError } from 'open-nfse';
import { Invoice } from '../domain/invoice';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import type { IFiscalSnapshotRepository } from '../domain/fiscal/fiscal-snapshot.repository';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import { PortalUnavailableError } from './fiscal-portal-breaker';
import {
  DISCARDED_ERROR_CODE,
  NfseWorkflowService,
  PORTAL_NFSE_UNVERIFIED,
  type FiscalJobData,
} from './nfse-workflow.service';
import {
  DPS_USED_BY_OTHER_NFSE,
  PORTAL_NFSE_WRONG_ENVIRONMENT,
} from '../domain/fiscal/portal-nfse-match';
import {
  PORTAL_DPS_QUERY_REJECTED,
  reconciliationJobKey,
} from './reconciliation-job';
import { portalNfseXml } from '../domain/fiscal/__fixtures__/portal-nfse-xml';

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
/** The NFS-e the portal returns for the test invoice's own DPS (1/7, R$ 100,00, 01/11/2026). */
const realXml = portalNfseXml({
  providerCnpj: company.taxId,
  amount: '100.00',
  competenceDate: '2026-11-01',
  series: '1',
  number: 7,
});
/** Another emission that already used DPS 1/7 of the same CNPJ: other value and day. */
const otherNoteXml = portalNfseXml({
  providerCnpj: company.taxId,
  amount: '49.90',
  competenceDate: '2026-10-16',
  series: '1',
  number: 7,
});
/** The invoice's own DPS and values, but a Produção Restrita note (tpAmb 2): no fiscal value on a live invoice. */
const testEnvironmentNote = {
  accessKey: '35347082261469487000140000000000000126109728631021',
  nfseNumber: 1,
  xmlAuthorized: portalNfseXml({
    providerCnpj: company.taxId,
    amount: '100.00',
    competenceDate: '2026-11-01',
    series: '1',
    number: 7,
    tpAmb: '2',
  }),
};
const authorized = {
  accessKey: '43144000000000000000000000000000000000000000000000',
  nfseNumber: 7,
  xmlAuthorized: realXml,
};
const otherNote = {
  accessKey: '35347082261469487000140000000000000126109728631021',
  nfseNumber: 1,
  xmlAuthorized: otherNoteXml,
};
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
    provider.issue.mockRejectedValue(new NetworkError('ECONNRESET'));

    await expect(run(invoice)).resolves.toBeUndefined();

    expect(breaker.recordFailure).toHaveBeenCalledWith('live');
    expect(invoice.status).toBe('reconciliation_required');
    expect(reconciliationJobs()).toHaveLength(1);
    expect(reconciliationJobs()[0][2]).toMatchObject({
      attemptCount: 1,
      uncertainSince: expect.any(String),
    });
  });

  describe('when the portal refuses the DPS lookup (HTTP 400)', () => {
    const refused = () =>
      new HttpStatusError(
        400,
        '{"erro":"Identificador de DPS invalido","cnpj":"11.222.333/0001-81","email":"a@b.com"}',
      );

    it('stops automatic attempts and moves to manual review with the portal detail', async () => {
      const invoice = invoiceIn('reconciliation_required');
      provider.issue.mockRejectedValue(refused());

      await run(invoice, { attemptCount: 1 });

      expect(invoice.status).toBe('manual_review');
      expect(reconciliationJobs()).toHaveLength(0);
      const snapshot = invoice.toSnapshot();
      expect(snapshot.lastErrorCode).toBe(PORTAL_DPS_QUERY_REJECTED);
      expect(snapshot.lastErrorMessage).toBe(
        'O portal recusou a consulta desta nota (código 400). Veja o detalhe.',
      );
      expect(snapshot.lastErrorProvider).toContain(
        'Identificador de DPS invalido',
      );
      expect(snapshot.lastErrorProvider).not.toContain('11.222.333');
      expect(snapshot.lastErrorProvider).not.toContain('a@b.com');
      const reasons = fakes.lifecycle.transition.mock.calls.map(
        ([, event]) => (event as { reason?: string }).reason,
      );
      expect(reasons.at(-1)).toContain('Detalhe do portal');
    });

    it('does not count as a portal outage', async () => {
      const invoice = invoiceIn('reconciliation_required');
      provider.issue.mockRejectedValue(refused());

      await run(invoice);

      expect(breaker.recordFailure).not.toHaveBeenCalled();
    });

    it('the sweep records it once and then stops asking the portal', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockRejectedValue(refused());

      await run(invoice, { review: 'sweep' });
      await run(invoice, { review: 'sweep' });

      expect(provider.queryByDps).toHaveBeenCalledTimes(1);
      expect(invoice.status).toBe('manual_review');
      expect(invoice.toSnapshot().lastErrorCode).toBe(
        PORTAL_DPS_QUERY_REJECTED,
      );
      expect(breaker.recordFailure).not.toHaveBeenCalled();
    });
  });

  it('chains each follow-up on a stable job id so a second chain collides', async () => {
    const invoice = invoiceIn('queued');
    provider.issue.mockRejectedValue(new NetworkError('ECONNRESET'));

    await run(invoice);

    expect(reconciliationJobs()[0][3]).toMatchObject({
      idempotencyKey: reconciliationJobKey(invoice.id, 1),
    });
  });

  it('stores "Sem conexão com o portal do governo" when the connection could not be opened', async () => {
    const invoice = invoiceIn('queued');
    provider.issue.mockRejectedValue(
      Object.assign(new Error('Requisição excedeu 60000ms.'), {
        name: 'TimeoutError',
        cause: { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' },
      }),
    );

    await run(invoice);

    expect(invoice.toSnapshot().lastErrorMessage).toBe(
      'Sem conexão com o portal do governo',
    );
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

  it('an emission answered with another note for the same DPS goes to manual review, not authorized', async () => {
    const invoice = invoiceIn('queued');
    provider.issue.mockResolvedValue({
      success: true,
      requiresReconciliation: false,
      ...otherNote,
    });

    await run(invoice);

    const snapshot = invoice.toSnapshot();
    expect(snapshot.status).toBe('manual_review');
    expect(snapshot.lastErrorCode).toBe(DPS_USED_BY_OTHER_NFSE);
    expect(snapshot.accessKey).toBeNull();
    expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
    expect(fakes.queues.add).not.toHaveBeenCalled();
  });

  it('a live invoice never takes a Produção Restrita note, even with the same DPS and values', async () => {
    const invoice = invoiceIn('queued');
    provider.issue.mockResolvedValue({
      success: true,
      requiresReconciliation: false,
      ...testEnvironmentNote,
    });

    await run(invoice);

    const snapshot = invoice.toSnapshot();
    expect(snapshot.status).toBe('manual_review');
    expect(snapshot.lastErrorCode).toBe(PORTAL_NFSE_WRONG_ENVIRONMENT);
    expect(snapshot.lastErrorMessage).toContain('é de teste');
    expect(snapshot.accessKey).toBeNull();
    expect(snapshot.authorizedAt).toBeNull();
    expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
    expect(fakes.queues.add).not.toHaveBeenCalled();
  });

  it('a reconciliation that finds another note for the same DPS goes to manual review', async () => {
    const invoice = invoiceIn('reconciliation_required');
    provider.issue.mockResolvedValue({
      success: true,
      requiresReconciliation: false,
      ...otherNote,
    });

    await run(invoice, { attemptCount: 1 });

    expect(invoice.status).toBe('manual_review');
    expect(invoice.toSnapshot().lastErrorCode).toBe(DPS_USED_BY_OTHER_NFSE);
    expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
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

    it('rejects and refunds when the DPS belongs to another note, never attaching it', async () => {
      const invoice = invoiceIn('manual_review');
      invoice.setRejected(DPS_USED_BY_OTHER_NFSE, 'já foi usado');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...otherNote,
      });

      await discard(invoice);

      const snapshot = invoice.toSnapshot();
      expect(snapshot.status).toBe('rejected');
      expect(snapshot.lastErrorCode).toBe(DPS_USED_BY_OTHER_NFSE);
      expect(snapshot.lastErrorMessage).toContain(
        'Esta nota foi descartada sem ser emitida e o crédito voltou.',
      );
      expect(snapshot.accessKey).toBeNull();
      expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
      expect(fakes.lifecycle.transition).toHaveBeenCalledWith(
        invoice,
        expect.objectContaining({ toStatus: 'rejected' }),
      );
      expect(provider.issue).not.toHaveBeenCalled();
    });

    it('keeps it in review when the portal note cannot be read', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
        xmlAuthorized: '<NFSe/>',
      });

      await discard(invoice);

      expect(invoice.status).toBe('manual_review');
      expect(invoice.toSnapshot().lastErrorCode).toBe(PORTAL_NFSE_UNVERIFIED);
      expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
    });

    it('an HTTP 400 answer from the portal does not count as an outage', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockRejectedValue(new HttpStatusError(400, ''));

      await discard(invoice);

      expect(breaker.recordFailure).not.toHaveBeenCalled();
      expect(invoice.status).toBe('manual_review');
    });

    it('stays in manual review with the reason when the portal does not answer', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockRejectedValue(new TimeoutError(60000));

      await discard(invoice);

      expect(invoice.status).toBe('manual_review');
      expect(invoice.toSnapshot().lastErrorMessage).toBe(
        'Discard not confirmed: no answer',
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

    it('never accepts a note it cannot read: stays in review, nothing stored', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...authorized,
        xmlAuthorized: realXml.replace(
          /<dhProc>[^<]*<\/dhProc>/,
          '<dhProc>sem data</dhProc>',
        ),
      });

      await sweep(invoice);

      expect(invoice.status).toBe('manual_review');
      expect(invoice.toSnapshot().lastErrorCode).toBe(PORTAL_NFSE_UNVERIFIED);
      expect(invoice.toSnapshot().accessKey).toBeNull();
      expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
    });

    it('refuses a Produção Restrita note on a live invoice and does not ask the portal again', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...testEnvironmentNote,
      });

      await sweep(invoice);

      expect(invoice.status).toBe('manual_review');
      expect(invoice.toSnapshot().lastErrorCode).toBe(
        PORTAL_NFSE_WRONG_ENVIRONMENT,
      );
      expect(invoice.toSnapshot().accessKey).toBeNull();
      expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
      expect(fakes.queues.add).not.toHaveBeenCalled();

      provider.queryByDps.mockClear();
      await sweep(invoice);
      expect(provider.queryByDps).not.toHaveBeenCalled();
    });

    it('refuses another note with the same DPS: stays in review with the reason, nothing stored or sent', async () => {
      const invoice = invoiceIn('manual_review');
      provider.queryByDps.mockResolvedValue({
        status: 'authorized',
        ...otherNote,
      });

      await sweep(invoice);

      const snapshot = invoice.toSnapshot();
      expect(snapshot.status).toBe('manual_review');
      expect(snapshot.lastErrorCode).toBe(DPS_USED_BY_OTHER_NFSE);
      expect(snapshot.lastErrorMessage).toContain(
        'O número de DPS 7 (série 1) já foi usado por outra nota (nº 1, de 16/10/2026, R$ 49,90). Esta nota não foi emitida.',
      );
      expect(snapshot.accessKey).toBeNull();
      expect(snapshot.nfseNumber).toBeNull();
      expect(snapshot.authorizedAt).toBeNull();
      expect(fakes.invoices.save).toHaveBeenCalledWith(invoice, tenantId);
      expect(fakes.documentStorage.saveXml).not.toHaveBeenCalled();
      expect(fakes.queues.add).not.toHaveBeenCalled();
      expect(provider.issue).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: invoice.id,
          outcome: 'portal_nfse_mismatch',
          errorCode: DPS_USED_BY_OTHER_NFSE,
          differences: ['amount', 'competenceDate'],
          portalNfseNumber: '1',
        }),
        'Fiscal reconciliation attempt',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('<');
    });

    it('does not ask the portal again for a DPS it already said belongs to another note', async () => {
      const invoice = invoiceIn('manual_review');
      invoice.setRejected(DPS_USED_BY_OTHER_NFSE, 'já foi usado');

      await sweep(invoice);

      expect(provider.queryByDps).not.toHaveBeenCalled();
      expect(invoice.status).toBe('manual_review');
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
