/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { WebhookEnvironment } from '@/modules/webhooks-config/domain/webhook-event';
import type { NFSe } from 'open-nfse';
import type { FiscalSnapshot } from '../../domain/fiscal/fiscal-snapshot.repository';
import type { FiscalCalculationResult } from '../../domain/fiscal/fiscal-calculation-result';
import type { Invoice } from '../../domain/invoice';

jest.mock('open-nfse', () => ({
  ...jest.requireActual('open-nfse'),
  parseNfseXml: jest.fn(),
}));

import { parseNfseXml } from 'open-nfse';

const calculationResult = (): FiscalCalculationResult => ({
  operationId: 'a1a1a1a1-1111-4111-8111-111111111111',
  companyId: 'b2b2b2b2-2222-4222-8222-222222222222',
  competenceDate: '2026-12-10',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: 'c3c3c3c3-3333-4333-8333-333333333333',
  classification: {
    serviceCode: '010601',
    municipalServiceCode: null,
    nbsCode: null,
    cst: null,
    classCode: null,
    operationIndicator: null,
    source: 'company_service_profile',
    serviceProfileId: null,
    operationNature: 'SERVICE',
    iss: {
      taxation: 'NORMAL',
      rate: '3',
      withholdingDefault: false,
      incidenceMunicipalityCode: '3550308',
    },
    withholding: { policy: 'NONE_CONFIRMED', rates: {} },
    catalogVersions: { nbs: '2026.1' },
    catalogValidated: true,
    justification: 'company service profile',
  },
  taxableAmounts: { gross: '1000.00', discount: '0.00' },
  taxes: { iss: { base: '1000.00', rate: '3', amount: '30.00' } },
  withholdings: [],
  netReceivableAmount: '864.90',
  applicability: {
    strategy: 'regular',
    customerRequired: true,
    iss: { status: 'REQUIRED' },
    issWithheld: { status: 'NOT_APPLICABLE', reason: 'no withholding' },
    federalWithholding: { status: 'NOT_APPLICABLE', reason: 'none' },
    cbs: { status: 'NOT_APPLICABLE', reason: 'information phase' },
    ibs: { status: 'NOT_APPLICABLE', reason: 'information phase' },
    specialTreatment: { status: 'NOT_APPLICABLE', reason: 'none' },
    collectionWaived: true,
    rulesVersion: '2026.10-r1',
    legalReferences: ['LC 116/2003'],
  },
  collectionWaived: true,
  calculationSource: 'legacy+rtc',
  calculatorVersion: 'rtc-2026.1',
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 116/2003'],
  warnings: [],
  requiresReview: false,
  trace: [{ step: 'RtcTaxCalculator', status: 'applied', durationMs: 2 }],
  calculationMemory: [],
});

const snapshotOf = (invoiceId: string, tenantId: string): FiscalSnapshot => ({
  id: 'd4d4d4d4-4444-4444-8444-444444444444',
  invoiceId,
  tenantId,
  companyId: 'b2b2b2b2-2222-4222-8222-222222222222',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: 'c3c3c3c3-3333-4333-8333-333333333333',
  serviceProfileId: null,
  specialTaxRegime: null,
  attempt: 1,
  calculationVersion: '2026.10-r1',
  grossAmount: '1000.00',
  discountAmount: '0.00',
  issAmount: '30.00',
  cbsAmount: null,
  ibsTotalAmount: null,
  netReceivableAmount: '864.90',
  result: calculationResult(),
  calculatedAt: new Date('2026-12-10T12:00:00Z'),
});

// Only the reconciled value groups are populated — reconcile() reads just
// these fields (open-nfse domain.d.ts), the rest of a real document is
// intentionally omitted.
const nfseOf = (vISSQN: number): NFSe =>
  ({
    infNFSe: {
      valores: { vServ: 1000, vLiq: 864.9, vISSQN, vBC: 1000 },
    },
  }) as unknown as NFSe;

const tenantId = 'e5e5e5e5-5555-4555-8555-555555555555';
const invoiceId = 'a1a1a1a1-1111-4111-8111-111111111111';

const invoiceOf = (
  overrides: Partial<Pick<Invoice, 'status' | 'environment'>> = {},
): Invoice =>
  ({
    id: invoiceId,
    tenantId,
    companyId: 'b2b2b2b2-2222-4222-8222-222222222222',
    status: 'authorized',
    environment: 'test' as WebhookEnvironment,
    executionEnvironment: 'test',
    documentsReadyAt: null,
    ...overrides,
  }) as unknown as Invoice;

describe('FiscalReconciliationService', () => {
  const parseMock = jest.mocked(parseNfseXml);
  let provider: MeterProvider;
  let exporter: InMemoryMetricExporter;
  let snapshots: {
    insert: jest.Mock;
    findByInvoiceId: jest.Mock;
  };
  let reconciliations: {
    insert: jest.Mock;
    findByInvoiceId: jest.Mock;
    findAuthorizedWithoutReconciliation: jest.Mock;
  };
  let invoices: { findByIdAndTenantId: jest.Mock };
  let storage: { getXml: jest.Mock; saveXml: jest.Mock };
  let publisher: { publish: jest.Mock };

  beforeAll(async () => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    expect(metrics.setGlobalMeterProvider(provider)).toBe(true);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    snapshots = {
      insert: jest.fn(),
      findByInvoiceId: jest
        .fn()
        .mockResolvedValue(snapshotOf(invoiceId, tenantId)),
    };
    reconciliations = {
      insert: jest.fn().mockResolvedValue(true),
      findByInvoiceId: jest.fn().mockResolvedValue(null),
      findAuthorizedWithoutReconciliation: jest.fn().mockResolvedValue([]),
    };
    invoices = {
      findByIdAndTenantId: jest.fn().mockResolvedValue(invoiceOf()),
    };
    storage = {
      getXml: jest.fn().mockResolvedValue('<Nfse>authorized</Nfse>'),
      saveXml: jest.fn(),
    };
    publisher = { publish: jest.fn() };
  });

  async function buildService() {
    const service =
      require('./fiscal-reconciliation.service') as typeof import('./fiscal-reconciliation.service');
    return new service.FiscalReconciliationService(
      snapshots,
      reconciliations,
      invoices as never,
      storage as never,
      publisher as never,
    );
  }

  async function mismatchCount(): Promise<number> {
    await provider.forceFlush();
    const resources = await exporter.getMetrics();
    for (const resource of resources.flatMap((entry) => entry.scopeMetrics)) {
      const metric = resource.metrics.find(
        (candidate) =>
          candidate.descriptor.name === 'corvo.fiscal.reconciliation.mismatch.total',
      );
      if (metric)
        return metric.dataPoints.reduce(
          (sum, point) => sum + Number(point.value),
          0,
        );
    }
    return 0;
  }

  it('persists one reconciliation row without touching snapshot, XML or status', async () => {
    parseMock.mockReturnValue(nfseOf(30));
    const service = await buildService();

    await service.reconcileInvoice(invoiceId, tenantId);

    expect(reconciliations.insert).toHaveBeenCalledTimes(1);
    const row = reconciliations.insert.mock.calls[0][0] as {
      invoiceId: string;
      tenantId: string;
      status: string;
      toleranceAbsolute: string;
      rulesVersion: string;
      reconciledAt: Date;
      localValues: Record<string, string | null>;
      authorizedValues: Record<string, string | null>;
      differences: unknown[];
    };
    expect(row.invoiceId).toBe(invoiceId);
    expect(row.tenantId).toBe(tenantId);
    expect(row.status).toBe('matched');
    expect(row.differences).toEqual([]);
    expect(row.toleranceAbsolute).toBe('0.01');
    expect(row.rulesVersion).toBe('2026.10-r1');
    expect(row.reconciledAt).toBeInstanceOf(Date);
    expect(row.localValues.iss).toBe('30.00');
    expect(row.authorizedValues.iss).toBe('30');
    expect(snapshots.insert).not.toHaveBeenCalled();
    expect(storage.saveXml).not.toHaveBeenCalled();
    expect(invoices.findByIdAndTenantId).toHaveBeenCalledTimes(1);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(await mismatchCount()).toBe(0);
  });

  it('is a no-op when there is no fiscal snapshot', async () => {
    snapshots.findByInvoiceId.mockResolvedValue(null);
    parseMock.mockReturnValue(nfseOf(30));
    const service = await buildService();

    await service.reconcileInvoice(invoiceId, tenantId);

    expect(storage.getXml).not.toHaveBeenCalled();
    expect(reconciliations.insert).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(await mismatchCount()).toBe(0);
  });

  it('is a no-op when the invoice is gone', async () => {
    invoices.findByIdAndTenantId.mockResolvedValue(null);
    parseMock.mockReturnValue(nfseOf(30));
    const service = await buildService();

    await service.reconcileInvoice(invoiceId, tenantId);

    expect(parseMock).not.toHaveBeenCalled();
    expect(reconciliations.insert).not.toHaveBeenCalled();
  });

  it('increments the mismatch counter and emits the webhook on a first divergent reconciliation', async () => {
    parseMock.mockReturnValue(nfseOf(31));
    const service = await buildService();

    await service.reconcileInvoice(invoiceId, tenantId);

    expect(reconciliations.insert.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        status: 'divergent',
        differences: [
          {
            field: 'iss',
            local: '30.00',
            authorized: '31',
            delta: '1.00',
            kind: 'amount',
          },
        ],
      }),
    );
    expect(await mismatchCount()).toBe(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const [context, type, data] = publisher.publish.mock.calls[0] as [
      { tenantId: string; invoiceId: string; environment: string },
      string,
      { invoiceId: string; status: string; differences: unknown[] },
    ];
    expect(context.tenantId).toBe(tenantId);
    expect(context.invoiceId).toBe(invoiceId);
    expect(context.environment).toBe('test');
    expect(type).toBe('nfse.invoice.fiscal_discrepancy');
    expect(data.invoiceId).toBe(invoiceId);
    expect(data.status).toBe('authorized');
    expect(data.differences).toHaveLength(1);
    // No XML or full documents in the webhook payload.
    expect(JSON.stringify(data)).not.toContain('Nfse');
  });

  it('does not re-emit the webhook when the divergent row already exists', async () => {
    parseMock.mockReturnValue(nfseOf(31));
    reconciliations.insert.mockResolvedValue(false);
    const service = await buildService();

    await service.reconcileInvoice(invoiceId, tenantId);

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

describe('InvoiceWebhookPublisher', () => {
  it('enqueues the event for every active subscription and skips inactive ones', async () => {
    const service =
      require('./fiscal-reconciliation.service') as typeof import('./fiscal-reconciliation.service');
    const configs = {
      findByTenantIdAndEvent: jest.fn().mockResolvedValue([
        { id: 'wh-1', url: 'https://a.test/hook', secret: 's1', active: true },
        { id: 'wh-2', url: 'https://b.test/hook', secret: 's2', active: false },
      ]),
    };
    const outbox = { enqueue: jest.fn() };
    const publisher = new service.InvoiceWebhookPublisher(
      configs as never,
      outbox as never,
    );

    await publisher.publish(
      {
        invoiceId,
        tenantId,
        companyId: 'b2b2b2b2-2222-4222-8222-222222222222',
        environment: 'test',
      },
      'nfse.invoice.fiscal_discrepancy',
      { invoiceId, status: 'authorized', differences: [] },
    );

    expect(configs.findByTenantIdAndEvent).toHaveBeenCalledWith(
      tenantId,
      'nfse.invoice.fiscal_discrepancy',
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        webhookConfigId: 'wh-1',
        eventType: 'nfse.invoice.fiscal_discrepancy',
        environment: 'test',
        url: 'https://a.test/hook',
        secret: 's1',
        payload: expect.objectContaining({
          type: 'nfse.invoice.fiscal_discrepancy',
          environment: 'test',
          data: { invoiceId, status: 'authorized', differences: [] },
        }),
      }),
    );
  });

  it('swallows enqueue failures so reconciliation is never blocked by webhooks', async () => {
    const service =
      require('./fiscal-reconciliation.service') as typeof import('./fiscal-reconciliation.service');
    const configs = {
      findByTenantIdAndEvent: jest
        .fn()
        .mockRejectedValue(new Error('webhook store down')),
    };
    const publisher = new service.InvoiceWebhookPublisher(
      configs as never,
      { enqueue: jest.fn() } as never,
    );

    await expect(
      publisher.publish(
        {
          invoiceId,
          tenantId,
          companyId: 'b2b2b2b2-2222-4222-8222-222222222222',
          environment: 'test',
        },
        'nfse.invoice.fiscal_discrepancy',
        { invoiceId, status: 'authorized', differences: [] },
      ),
    ).resolves.toBeUndefined();
  });
});
