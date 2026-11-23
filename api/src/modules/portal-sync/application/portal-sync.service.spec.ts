/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { NetworkError, StatusDistribuicao } from 'open-nfse';
import { PortalUnavailableError } from '@/modules/invoice/application/fiscal-portal-breaker';
import { CertificateNotFoundError } from '@/modules/certificate/domain/errors';
import type {
  NewPortalDocument,
  PortalSyncCursor,
  StoredPortalDocument,
  SyncTarget,
} from '../domain/portal-sync.repository';
import { ACCESS_KEY, CANCELLATION_XML } from '../__fixtures__/portal-events';
import { PortalSyncService } from './portal-sync.service';

const TENANT = 'tenant-a';
const target: SyncTarget = { companyId: 'company-1', environment: 'live' };
const NOW = new Date('2026-11-11T12:00:00Z');
const HOUR = 3_600_000;

/** In-memory stand-in for the repository, keyed like the real tables are. */
class MemoryRepository {
  cursors = new Map<string, PortalSyncCursor>();
  documents = new Map<string, StoredPortalDocument>();
  failSaveAt: number | null = null;
  calls: Array<{ tenantId: string; op: string }> = [];

  private key(tenantId: string, t: SyncTarget) {
    return `${tenantId}/${t.companyId}/${t.environment}`;
  }

  findCursor = jest.fn((tenantId: string, t: SyncTarget) => {
    this.calls.push({ tenantId, op: 'findCursor' });
    return Promise.resolve(this.cursors.get(this.key(tenantId, t)) ?? null);
  });
  createCursor = jest.fn((tenantId: string, t: SyncTarget, nextRunAt: Date) => {
    this.cursors.set(this.key(tenantId, t), {
      lastNsu: 0,
      firstRoundDoneAt: null,
      nextRunAt,
      idleRuns: 0,
      failures: 0,
    });
    return Promise.resolve();
  });
  updateCursor = jest.fn(
    (tenantId: string, t: SyncTarget, update: Partial<PortalSyncCursor>) => {
      const key = this.key(tenantId, t);
      this.cursors.set(key, { ...this.cursors.get(key)!, ...update });
      return Promise.resolve();
    },
  );
  saveDocument = jest.fn(
    (tenantId: string, t: SyncTarget, document: NewPortalDocument) => {
      if (this.failSaveAt === document.nsu)
        return Promise.reject(new Error('disk full'));
      const key = `${this.key(tenantId, t)}/${document.nsu}`;
      // Same NSU again changes nothing, as the unique index does.
      if (!this.documents.has(key))
        this.documents.set(key, {
          ...document,
          id: key,
          attempts: 0,
          processed: false,
        } as StoredPortalDocument);
      return Promise.resolve();
    },
  );
  listUnprocessed = jest.fn(
    (tenantId: string, t: SyncTarget, maxAttempts: number) =>
      Promise.resolve(
        [...this.documents.values()]
          .filter(
            (d) =>
              d.id.startsWith(this.key(tenantId, t)) &&
              !(d as unknown as { processed: boolean }).processed &&
              d.attempts < maxAttempts,
          )
          .sort((a, b) => a.nsu - b.nsu),
      ),
  );
  markProcessed = jest.fn((_tenantId: string, id: string) => {
    (this.documents.get(id) as unknown as { processed: boolean }).processed =
      true;
    return Promise.resolve();
  });
  markFailed = jest.fn((_tenantId: string, id: string) => {
    this.documents.get(id)!.attempts += 1;
    return Promise.resolve();
  });
}

function doc(nsu: number, over: Record<string, unknown> = {}) {
  return {
    nsu,
    chaveAcesso: ACCESS_KEY,
    tipoDocumento: 'EVENTO',
    tipoEvento: 'CANCELAMENTO',
    xmlDocumento: CANCELLATION_XML,
    dataHoraGeracao: new Date('2026-11-10T10:00:00Z'),
    ...over,
  };
}

function page(documents: Array<ReturnType<typeof doc>>, lastNsu: number) {
  return {
    status: StatusDistribuicao.DocumentosEncontrados,
    documentos: documents,
    alertas: [],
    erros: [],
    ultimoNsu: Math.max(lastNsu, ...documents.map((d) => d.nsu)),
  };
}

const EMPTY = (lastNsu: number) => ({
  status: StatusDistribuicao.NenhumDocumento,
  documentos: [],
  alertas: [],
  erros: [
    { codigo: 'E2220', descricao: 'Nenhum documento', complemento: null },
  ],
  ultimoNsu: lastNsu,
});

function setup(
  options: {
    cursor?: Partial<PortalSyncCursor> | null;
    simulated?: boolean;
  } = {},
) {
  const repository = new MemoryRepository();
  if (options.cursor !== null)
    repository.cursors.set(`${TENANT}/${target.companyId}/live`, {
      lastNsu: 0,
      firstRoundDoneAt: new Date('2026-11-01T00:00:00Z'),
      nextRunAt: new Date(NOW.getTime() - 1),
      idleRuns: 0,
      failures: 0,
      ...options.cursor,
    });
  const provider = { fetchPortalDocuments: jest.fn() };
  const providers = {
    isSimulated: jest.fn().mockReturnValue(!!options.simulated),
  };
  const certificates = {
    decryptCredentials: jest
      .fn()
      .mockResolvedValue({ pfxBuffer: Buffer.from('pfx'), password: 'pw' }),
  };
  const breaker = {
    assertAvailable: jest.fn().mockResolvedValue(undefined),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };
  const processor = { process: jest.fn().mockResolvedValue(undefined) };
  const service = new PortalSyncService(
    repository as never,
    provider as never,
    providers as never,
    certificates as never,
    breaker as never,
    processor as never,
  );
  return {
    service,
    repository,
    provider,
    providers,
    certificates,
    breaker,
    processor,
  };
}

const cursorOf = (repository: MemoryRepository, tenant = TENANT) =>
  repository.cursors.get(`${tenant}/${target.companyId}/live`)!;

describe('PortalSyncService', () => {
  describe('the cursor loop', () => {
    it('reads pages until the portal has nothing newer, storing each document before the cursor moves', async () => {
      const { service, repository, provider } = setup();
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1), doc(2)], 0))
        .mockResolvedValueOnce(page([doc(3)], 2))
        .mockResolvedValueOnce(EMPTY(3));

      const result = await service.sync(TENANT, target, NOW);

      expect(result.status).toBe('synced');
      expect(
        provider.fetchPortalDocuments.mock.calls.map(
          (call) => call[2] as number,
        ),
      ).toEqual([0, 2, 3]);
      expect(repository.documents.size).toBe(3);
      expect(cursorOf(repository).lastNsu).toBe(3);
      // The cursor is written only after the page's documents are.
      const order = [
        ...repository.saveDocument.mock.invocationCallOrder,
        ...repository.updateCursor.mock.invocationCallOrder,
      ];
      expect(
        repository.updateCursor.mock.invocationCallOrder[0],
      ).toBeGreaterThan(repository.saveDocument.mock.invocationCallOrder[1]);
      expect(order.length).toBeGreaterThan(3);
    });

    it('a failure in the middle of a page leaves the cursor before it and loses nothing', async () => {
      const { service, repository, provider, breaker } = setup();
      repository.failSaveAt = 3;
      provider.fetchPortalDocuments.mockResolvedValue(
        page([doc(1), doc(2), doc(3), doc(4)], 0),
      );

      const result = await service.sync(TENANT, target, NOW);

      expect(result.status).toBe('failed');
      // Documents before the failure are kept, the cursor did not move past the page.
      expect([...repository.documents.values()].map((d) => d.nsu)).toEqual([
        1, 2,
      ]);
      expect(cursorOf(repository).lastNsu).toBe(0);
      expect(cursorOf(repository).failures).toBe(1);
      expect(breaker.recordFailure).not.toHaveBeenCalled();

      // The next run reads the same page again and ends up with all four, once each.
      repository.failSaveAt = null;
      provider.fetchPortalDocuments
        .mockReset()
        .mockResolvedValueOnce(page([doc(1), doc(2), doc(3), doc(4)], 0))
        .mockResolvedValueOnce(EMPTY(4));
      const later = new Date(NOW.getTime() + 3 * HOUR);
      await service.sync(TENANT, target, later);

      expect([...repository.documents.values()].map((d) => d.nsu)).toEqual([
        1, 2, 3, 4,
      ]);
      expect(cursorOf(repository).lastNsu).toBe(4);
    });

    it('reading the same NSU twice does not duplicate it or process it twice', async () => {
      const { service, repository, provider, processor } = setup();
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1)], 0))
        .mockResolvedValueOnce(EMPTY(1))
        // A later run starts again from an older cursor (e.g. restored) and gets NSU 1 once more.
        .mockResolvedValueOnce(page([doc(1)], 0))
        .mockResolvedValueOnce(EMPTY(1));

      await service.sync(TENANT, target, NOW);
      repository.cursors.set(`${TENANT}/${target.companyId}/live`, {
        ...cursorOf(repository),
        lastNsu: 0,
        nextRunAt: NOW,
      });
      await service.sync(TENANT, target, new Date(NOW.getTime() + HOUR));

      expect(repository.documents.size).toBe(1);
      expect(processor.process).toHaveBeenCalledTimes(1);
    });

    it('a document that cannot be processed does not hold the cursor, and is tried again next run', async () => {
      const { service, repository, provider, processor } = setup();
      processor.process
        .mockRejectedValueOnce(new Error('unreadable'))
        .mockResolvedValue(undefined);
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1, { tipoEvento: null }), doc(2)], 0))
        .mockResolvedValueOnce(EMPTY(2))
        .mockResolvedValueOnce(EMPTY(2));

      const first = await service.sync(TENANT, target, NOW);

      expect(first.status).toBe('synced');
      expect(cursorOf(repository).lastNsu).toBe(2);
      expect(repository.markFailed).toHaveBeenCalledTimes(1);
      expect(repository.markProcessed).toHaveBeenCalledTimes(1);

      await service.sync(TENANT, target, new Date(NOW.getTime() + 2 * HOUR));
      // The second pass retried NSU 1 (and nothing else).
      expect(processor.process).toHaveBeenCalledTimes(3);
      expect(repository.markProcessed).toHaveBeenCalledTimes(2);
    });

    it('gives up on a document after five failed tries, still stored', async () => {
      const { service, repository, provider, processor } = setup();
      processor.process.mockRejectedValue(new Error('unreadable'));
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1, { tipoEvento: null })], 0))
        .mockResolvedValue(EMPTY(1));

      for (let run = 0; run < 7; run++)
        await service.sync(
          TENANT,
          target,
          new Date(NOW.getTime() + run * 12 * HOUR),
        );

      expect(processor.process).toHaveBeenCalledTimes(5);
      expect(repository.documents.size).toBe(1);
    });

    it('tries each document once per run, even when the run reads several pages', async () => {
      const { service, provider, processor } = setup();
      processor.process.mockRejectedValue(new Error('unreadable'));
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1)], 0))
        .mockResolvedValueOnce(page([doc(2)], 1))
        .mockResolvedValueOnce(page([doc(3)], 2))
        .mockResolvedValueOnce(EMPTY(3));

      await service.sync(TENANT, target, NOW);

      expect(processor.process).toHaveBeenCalledTimes(3);
    });

    it('stops at the page budget and comes back on the next tick instead of waiting an hour', async () => {
      const { service, repository, provider } = setup();
      let nsu = 0;
      provider.fetchPortalDocuments.mockImplementation(() =>
        Promise.resolve(page([doc(++nsu)], nsu - 1)),
      );

      await service.sync(TENANT, target, NOW);

      expect(provider.fetchPortalDocuments).toHaveBeenCalledTimes(20);
      expect(cursorOf(repository).nextRunAt).toEqual(NOW);
      expect(cursorOf(repository).firstRoundDoneAt).toEqual(
        new Date('2026-11-01T00:00:00Z'),
      );
    });

    it('stops when the cursor does not advance, so a repeated page cannot loop forever', async () => {
      const { service, provider } = setup({ cursor: { lastNsu: 5 } });
      provider.fetchPortalDocuments.mockResolvedValue({
        ...EMPTY(5),
        status: StatusDistribuicao.DocumentosEncontrados,
      });

      await service.sync(TENANT, target, NOW);

      expect(provider.fetchPortalDocuments).toHaveBeenCalledTimes(1);
    });

    it('skips documents without an NSU', async () => {
      const { service, repository, provider } = setup();
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(0), doc(7)], 0))
        .mockResolvedValueOnce(EMPTY(7));

      await service.sync(TENANT, target, NOW);

      expect([...repository.documents.values()].map((d) => d.nsu)).toEqual([7]);
    });
  });

  describe('the first round', () => {
    it('processes history in silence, and only documents after the first complete read can notify', async () => {
      const { service, repository, provider, processor } = setup({
        cursor: { firstRoundDoneAt: null },
      });
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1)], 0))
        .mockResolvedValueOnce(EMPTY(1))
        .mockResolvedValueOnce(
          page(
            [doc(2, { dataHoraGeracao: new Date('2026-11-11T13:00:00Z') })],
            1,
          ),
        )
        .mockResolvedValueOnce(EMPTY(2));

      await service.sync(TENANT, target, NOW);
      expect(processor.process.mock.calls[0][1]).toMatchObject({
        silent: true,
      });
      expect(cursorOf(repository).firstRoundDoneAt).toEqual(NOW);

      await service.sync(TENANT, target, new Date(NOW.getTime() + 2 * HOUR));
      expect(processor.process.mock.calls[1][1]).toMatchObject({
        silent: false,
      });
    });

    it('stays silent while the first round is still going over several runs', async () => {
      const { service, repository, provider, processor } = setup({
        cursor: { firstRoundDoneAt: null },
      });
      let nsu = 0;
      provider.fetchPortalDocuments.mockImplementation(() =>
        Promise.resolve(page([doc(++nsu)], nsu - 1)),
      );

      await service.sync(TENANT, target, NOW);

      expect(cursorOf(repository).firstRoundDoneAt).toBeNull();
      expect(
        processor.process.mock.calls.every(
          (call) => (call[1] as { silent: boolean }).silent,
        ),
      ).toBe(true);
    });
  });

  describe('when it does not run', () => {
    it('a company seen for the first time only gets a cursor, due somewhere in the hour', async () => {
      const { service, repository, provider } = setup({ cursor: null });

      const result = await service.sync(TENANT, target, NOW);

      expect(result.status).toBe('scheduled');
      expect(provider.fetchPortalDocuments).not.toHaveBeenCalled();
      const due = cursorOf(repository).nextRunAt.getTime() - NOW.getTime();
      expect(due).toBeGreaterThanOrEqual(0);
      expect(due).toBeLessThan(HOUR);
    });

    it('spreads different companies over the hour', async () => {
      const delays = new Set<number>();
      for (let n = 0; n < 20; n++) {
        const { service, repository } = setup({ cursor: null });
        await service.sync(
          TENANT,
          { ...target, companyId: `company-${n}` },
          NOW,
        );
        delays.add(
          repository.cursors
            .get(`${TENANT}/company-${n}/live`)!
            .nextRunAt.getTime(),
        );
      }
      expect(delays.size).toBeGreaterThan(5);
    });

    it('waits for the due time', async () => {
      const { service, provider } = setup({
        cursor: { nextRunAt: new Date(NOW.getTime() + 1000) },
      });

      expect((await service.sync(TENANT, target, NOW)).status).toBe('skipped');
      expect(provider.fetchPortalDocuments).not.toHaveBeenCalled();
    });

    it('skips without error when the certificate is gone or expired', async () => {
      const gone = setup();
      gone.certificates.decryptCredentials.mockRejectedValue(
        new CertificateNotFoundError('company-1'),
      );
      expect((await gone.service.sync(TENANT, target, NOW)).status).toBe(
        'skipped',
      );
      expect(cursorOf(gone.repository).failures).toBe(0);

      const expired = setup();
      expired.certificates.decryptCredentials.mockRejectedValue(
        new Error('Certificate expired'),
      );
      expect((await expired.service.sync(TENANT, target, NOW)).status).toBe(
        'skipped',
      );
      expect(expired.provider.fetchPortalDocuments).not.toHaveBeenCalled();
    });

    it('records a refused or broken certificate as an error on the cursor', async () => {
      const { service, repository, certificates } = setup();
      certificates.decryptCredentials.mockRejectedValue(
        new Error('Invalid certificate bundle; upload it again'),
      );

      expect((await service.sync(TENANT, target, NOW)).status).toBe('failed');
      expect(cursorOf(repository).failures).toBe(1);
    });

    it('respects the portal breaker without counting it against the company', async () => {
      const { service, repository, breaker, provider } = setup();
      breaker.assertAvailable.mockRejectedValue(
        new PortalUnavailableError(new Date(NOW.getTime() + 60_000)),
      );

      expect((await service.sync(TENANT, target, NOW)).status).toBe('skipped');
      expect(provider.fetchPortalDocuments).not.toHaveBeenCalled();
      expect(cursorOf(repository).failures).toBe(0);
    });

    it('never reads the portal for the in-process simulator', async () => {
      const { service, provider, repository } = setup({ simulated: true });

      expect((await service.sync(TENANT, target, NOW)).status).toBe('skipped');
      expect(provider.fetchPortalDocuments).not.toHaveBeenCalled();
      expect(repository.findCursor).not.toHaveBeenCalled();
    });
  });

  describe('failures and pacing', () => {
    it('a portal outage opens the breaker and backs off longer after each failure in a row', async () => {
      const { service, repository, provider, breaker } = setup();
      provider.fetchPortalDocuments.mockRejectedValue(new NetworkError('down'));

      await service.sync(TENANT, target, NOW);
      expect(breaker.recordFailure).toHaveBeenCalledWith('live');
      expect(cursorOf(repository)).toMatchObject({ failures: 1, lastNsu: 0 });
      expect(cursorOf(repository).nextRunAt).toEqual(
        new Date(NOW.getTime() + HOUR),
      );

      const second = new Date(NOW.getTime() + HOUR);
      await service.sync(TENANT, target, second);
      expect(cursorOf(repository).failures).toBe(2);
      expect(cursorOf(repository).nextRunAt).toEqual(
        new Date(second.getTime() + 2 * HOUR),
      );
    });

    it('a portal rejection is an error on the cursor, not a move', async () => {
      const { service, repository, provider } = setup();
      provider.fetchPortalDocuments.mockResolvedValue({
        ...EMPTY(0),
        status: StatusDistribuicao.Rejeicao,
        erros: [
          {
            codigo: 'E1',
            descricao: 'Certificado inválido',
            complemento: null,
          },
        ],
      });

      expect((await service.sync(TENANT, target, NOW)).status).toBe('failed');
      expect(cursorOf(repository).lastError).toContain('Certificado inválido');
      expect(cursorOf(repository).lastNsu).toBe(0);
    });

    it('a success clears the failures and asks the portal less often when nothing comes', async () => {
      const { service, repository, provider, breaker } = setup({
        cursor: { failures: 3, idleRuns: 2 },
      });
      provider.fetchPortalDocuments.mockResolvedValue(EMPTY(0));

      await service.sync(TENANT, target, NOW);

      expect(breaker.recordSuccess).toHaveBeenCalledWith('live');
      expect(cursorOf(repository)).toMatchObject({
        failures: 0,
        idleRuns: 3,
        lastError: null,
      });
      expect(cursorOf(repository).nextRunAt).toEqual(
        new Date(NOW.getTime() + 3 * HOUR),
      );
    });

    it('reads again in an hour when something came', async () => {
      const { service, repository, provider } = setup({
        cursor: { idleRuns: 5 },
      });
      provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1)], 0))
        .mockResolvedValueOnce(EMPTY(1));

      await service.sync(TENANT, target, NOW);

      expect(cursorOf(repository).idleRuns).toBe(0);
      expect(cursorOf(repository).nextRunAt).toEqual(
        new Date(NOW.getTime() + HOUR),
      );
    });
  });

  describe('isolation', () => {
    it('reads and writes only inside the workspace it was called for', async () => {
      const a = setup();
      a.provider.fetchPortalDocuments
        .mockResolvedValueOnce(page([doc(1)], 0))
        .mockResolvedValueOnce(EMPTY(1));

      await a.service.sync(TENANT, target, NOW);

      const tenants = new Set<string>();
      for (const mock of [
        a.repository.findCursor,
        a.repository.updateCursor,
        a.repository.saveDocument,
        a.repository.listUnprocessed,
        a.repository.markProcessed,
      ])
        for (const call of mock.mock.calls) tenants.add(call[0]);
      expect([...tenants]).toEqual([TENANT]);
      expect(a.certificates.decryptCredentials).toHaveBeenCalledWith(
        target.companyId,
        TENANT,
        'live',
      );
      expect(a.processor.process.mock.calls[0][1]).toMatchObject({
        tenantId: TENANT,
      });
    });

    it('the same NSU in two workspaces is two documents', async () => {
      const shared = new MemoryRepository();
      const run = async (tenant: string) => {
        const { service, provider } = setup();
        // Reuse one repository so both workspaces write to the same "tables".
        (service as unknown as { repository: MemoryRepository }).repository =
          shared;
        shared.cursors.set(`${tenant}/${target.companyId}/live`, {
          lastNsu: 0,
          firstRoundDoneAt: new Date('2026-11-01T00:00:00Z'),
          nextRunAt: NOW,
          idleRuns: 0,
          failures: 0,
        });
        provider.fetchPortalDocuments
          .mockResolvedValueOnce(page([doc(1)], 0))
          .mockResolvedValueOnce(EMPTY(1));
        await service.sync(tenant, target, NOW);
      };

      await run('tenant-a');
      await run('tenant-b');

      expect(shared.documents.size).toBe(2);
      expect(
        shared.cursors.get(`tenant-a/${target.companyId}/live`)!.lastNsu,
      ).toBe(1);
      expect(
        shared.cursors.get(`tenant-b/${target.companyId}/live`)!.lastNsu,
      ).toBe(1);
    });
  });
});
