import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { TaxApplicability } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { FiscalCalculationResult } from '@/modules/invoice/domain/fiscal/fiscal-calculation-result';
import { fiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, ok } from '@/modules/invoice/domain/fiscal/result';
import { Invoice } from '@/modules/invoice/domain/invoice';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import {
  CalculateTaxesHandler,
  INVOICE_CALCULATE_TAXES,
} from './calculate-taxes.handler';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';

const classification = (
  overrides: Partial<ServiceTaxClassification> = {},
): ServiceTaxClassification => ({
  serviceCode: '060101',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
  source: 'company_service_profile',
  serviceProfileId: 'sp-1',
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
  ...overrides,
});

const applicability = (): TaxApplicability => ({
  strategy: 'regular',
  customerRequired: true,
  iss: { status: 'REQUIRED' },
  issWithheld: { status: 'NOT_APPLICABLE', reason: 'no withholding' },
  federalWithholding: { status: 'NOT_APPLICABLE', reason: 'none' },
  cbs: { status: 'REQUIRED' },
  ibs: { status: 'REQUIRED' },
  specialTreatment: { status: 'NOT_APPLICABLE', reason: 'none' },
  collectionWaived: true,
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 116/2003'],
});

const calculationResult = (
  overrides: Partial<FiscalCalculationResult> = {},
): FiscalCalculationResult => ({
  operationId: 'inv-x',
  companyId,
  competenceDate: '2026-10-13',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: 'cfp-1',
  classification: classification(),
  taxableAmounts: { gross: '50.00', discount: '0.00' },
  taxes: { iss: { base: '50.00', rate: '3', amount: '1.50' } },
  withholdings: [],
  netReceivableAmount: '48.50',
  applicability: applicability(),
  collectionWaived: true,
  calculationSource: 'legacy',
  calculatorVersion: null,
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: [],
  warnings: [],
  requiresReview: false,
  trace: [{ step: 'LegacyTaxCalculator', status: 'applied', durationMs: 1 }],
  calculationMemory: [],
  ...overrides,
});

const newInvoice = () =>
  Invoice.create(
    {
      companyId,
      environment: 'test',
      customer: { taxId: '52998224725', name: 'Cliente' },
      service: {
        description: 'Servico',
        code: '060101',
        municipalityCode: '3550308',
      },
      amount: 50,
      competenceDate: new Date('2026-10-13'),
    },
    tenantId,
  );

const messageFor = (invoice: Invoice, attempts = 1): OutboxMessage => ({
  id: 'm1',
  tenantId,
  environment: 'test',
  type: INVOICE_CALCULATE_TAXES,
  aggregateId: invoice.id,
  dedupeKey: `calc:${invoice.id}`,
  status: 'claimed',
  availableAt: new Date(),
  leaseUntil: null,
  attempts,
  lastError: null,
  payload: {
    invoiceId: invoice.id,
    companyId: invoice.companyId,
    tenantId,
  },
});

function build() {
  const transaction = { active: false };
  const unitOfWork = {
    execute: jest.fn(async (work: () => Promise<void>) => {
      transaction.active = true;
      try {
        await work();
      } finally {
        transaction.active = false;
      }
    }),
  };
  const invoices = { findByIdAndTenantId: jest.fn() };
  const companies = { findById: jest.fn() };
  const profiles = { findEffective: jest.fn() };
  const engine = { calculate: jest.fn() };
  const snapshots = {
    persist: jest.fn().mockResolvedValue('snap-1'),
    findByInvoiceId: jest.fn().mockResolvedValue(null),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue(true) };
  const lifecycle = { transition: jest.fn() };
  const registry = new OutboxHandlerRegistry();
  const handler = new CalculateTaxesHandler(
    invoices as never,
    companies as never,
    profiles as never,
    engine as never,
    snapshots as never,
    outbox as never,
    lifecycle as never,
    unitOfWork as never,
    registry,
  );
  return {
    handler,
    transaction,
    unitOfWork,
    invoices,
    companies,
    profiles,
    engine,
    snapshots,
    outbox,
    lifecycle,
    registry,
  };
}

describe('CalculateTaxesHandler', () => {
  it('persists the snapshot and enqueues invoice.emit in one transaction on success', async () => {
    const fakes = build();
    const invoice = newInvoice();
    const result = calculationResult();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.companies.findById.mockResolvedValue({ id: companyId });
    fakes.profiles.findEffective.mockResolvedValue({
      specialTaxRegime: 'ME_EPP',
    });
    fakes.engine.calculate.mockResolvedValue(ok(result));
    const managers: unknown[] = [];
    fakes.snapshots.persist.mockImplementation(async () => {
      managers.push(fakes.transaction.active);
      return 'snap-1';
    });
    fakes.outbox.enqueue.mockImplementation(async () => {
      managers.push(fakes.transaction.active);
      return true;
    });

    await fakes.handler.handle(messageFor(invoice, 3));

    expect(fakes.companies.findById).toHaveBeenCalledWith(
      companyId,
      tenantId,
      'test',
    );
    expect(fakes.engine.calculate).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({ id: companyId }),
    );
    expect(fakes.profiles.findEffective).toHaveBeenCalledWith(
      companyId,
      tenantId,
      '2026-10-13',
    );
    expect(fakes.snapshots.persist).toHaveBeenCalledWith({
      invoiceId: invoice.id,
      tenantId,
      result,
      specialTaxRegime: 'ME_EPP',
      attempt: 3,
      trace: result.trace,
    });
    expect(fakes.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        environment: 'test',
        type: 'invoice.emit',
        aggregateId: invoice.id,
        payload: { invoiceId: invoice.id, companyId, tenantId },
        dedupeKey: `emission:${invoice.id}`,
      }),
    );
    // Snapshot insert and emission enqueue share the caller's transaction.
    expect(fakes.unitOfWork.execute).toHaveBeenCalledTimes(1);
    expect(managers).toEqual([true, true]);
    expect(fakes.lifecycle.transition).not.toHaveBeenCalled();
  });

  it('no-ops when the invoice is not found', async () => {
    const fakes = build();
    const invoice = newInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(null);

    await fakes.handler.handle(messageFor(invoice));

    expect(fakes.engine.calculate).not.toHaveBeenCalled();
    expect(fakes.snapshots.persist).not.toHaveBeenCalled();
    expect(fakes.outbox.enqueue).not.toHaveBeenCalled();
    expect(fakes.lifecycle.transition).not.toHaveBeenCalled();
    expect(fakes.unitOfWork.execute).not.toHaveBeenCalled();
  });

  it('no-ops when the invoice is no longer queued', async () => {
    const fakes = build();
    const invoice = newInvoice();
    invoice.setProcessing();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    await fakes.handler.handle(messageFor(invoice));

    expect(fakes.engine.calculate).not.toHaveBeenCalled();
    expect(fakes.snapshots.persist).not.toHaveBeenCalled();
    expect(fakes.outbox.enqueue).not.toHaveBeenCalled();
    expect(fakes.lifecycle.transition).not.toHaveBeenCalled();
    expect(fakes.unitOfWork.execute).not.toHaveBeenCalled();
  });

  it('reuses an existing snapshot and only guarantees the emission message', async () => {
    const fakes = build();
    const invoice = newInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.snapshots.findByInvoiceId.mockResolvedValue({ id: 'snap-1' });

    await fakes.handler.handle(messageFor(invoice));

    expect(fakes.engine.calculate).not.toHaveBeenCalled();
    expect(fakes.snapshots.persist).not.toHaveBeenCalled();
    expect(fakes.outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(fakes.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'invoice.emit',
        aggregateId: invoice.id,
        dedupeKey: `emission:${invoice.id}`,
        payload: { invoiceId: invoice.id, companyId, tenantId },
      }),
    );
    expect(fakes.unitOfWork.execute).not.toHaveBeenCalled();
  });

  it('rejects the invoice without rethrowing on a non-retryable fiscal error', async () => {
    const fakes = build();
    const invoice = newInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.engine.calculate.mockResolvedValue(
      err(
        fiscalError({
          code: 'FISCAL_CLASSIFICATION_REQUIRED',
          message: 'Classificacao tributaria obrigatoria',
          category: 'CLASSIFICATION',
          details: { serviceCode: '060101' },
        }),
      ),
    );

    await expect(
      fakes.handler.handle(messageFor(invoice)),
    ).resolves.toBeUndefined();

    expect(invoice.status).toBe('rejected');
    const snapshotProps = invoice.toSnapshot();
    expect(snapshotProps.lastErrorCode).toBe('FISCAL_CLASSIFICATION_REQUIRED');
    expect(snapshotProps.lastErrorMessage).toBe(
      'Classificacao tributaria obrigatoria',
    );
    expect(fakes.lifecycle.transition).toHaveBeenCalledTimes(1);
    expect(fakes.lifecycle.transition).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({
        fromStatus: 'queued',
        toStatus: 'rejected',
        reason: 'Classificacao tributaria obrigatoria',
      }),
    );
    expect(fakes.snapshots.persist).not.toHaveBeenCalled();
    expect(fakes.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('rethrows retryable integration errors so the outbox relay retries', async () => {
    const fakes = build();
    const invoice = newInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.engine.calculate.mockResolvedValue(
      err(
        fiscalError({
          code: 'TAX_CALCULATION_UNAVAILABLE',
          message: 'RTC indisponivel',
          category: 'INTEGRATION',
          retryable: true,
        }),
      ),
    );

    await expect(fakes.handler.handle(messageFor(invoice))).rejects.toThrow(
      'TAX_CALCULATION_UNAVAILABLE',
    );

    expect(fakes.lifecycle.transition).not.toHaveBeenCalled();
    expect(fakes.snapshots.persist).not.toHaveBeenCalled();
    expect(fakes.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('propagates unexpected pipeline exceptions for the relay backoff', async () => {
    const fakes = build();
    const invoice = newInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.engine.calculate.mockRejectedValue(new Error('boom'));

    await expect(fakes.handler.handle(messageFor(invoice))).rejects.toThrow(
      'boom',
    );
  });

  it('registers itself on module init', () => {
    const fakes = build();
    fakes.handler.onModuleInit();
    expect(fakes.registry.get(INVOICE_CALCULATE_TAXES)).toBe(fakes.handler);
  });
});
