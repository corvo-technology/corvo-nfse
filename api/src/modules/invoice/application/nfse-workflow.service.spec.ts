/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { ConfigService } from '@nestjs/config';
import { NfseWorkflowService } from './nfse-workflow.service';
import {
  recordAuthorizationFailure,
  recordDpsValidationFailure,
} from './fiscal/fiscal.metrics';

jest.mock('./fiscal/fiscal.metrics');
import { Invoice } from '../domain/invoice';
import type { CustomerSnapshot } from '../domain/invoice';
import type { IIssuePayload } from '@/infra/external/nfse/nfse-fiscal-provider';
import { buildInvoiceState } from '../domain/invoice-state';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import type {
  FiscalSnapshot,
  IFiscalSnapshotRepository,
} from '../domain/fiscal/fiscal-snapshot.repository';
import type { FiscalCalculationResult } from '../domain/fiscal/fiscal-calculation-result';
import type { ServiceTaxClassification } from '../domain/fiscal/classification/service-tax-classification';
import type {
  Obligation,
  TaxApplicability,
} from '../domain/fiscal/applicability/tax-applicability';

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
      {} as unknown as IFiscalSnapshotRepository,
      new DpsBuilder(),
      {} as unknown as ConfigService,
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
    fiscalSnapshots: { findByInvoiceId: jest.fn() },
    config: { getOrThrow: jest.fn() },
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
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(null);
    fakes.config.getOrThrow.mockReturnValue({ dpsLayout: 'rtc-v1.01' });
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
      fakes.fiscalSnapshots as unknown as IFiscalSnapshotRepository,
      new DpsBuilder(),
      fakes.config as unknown as ConfigService,
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

  it('looks up the fiscal profile on the competence calendar date, not the previous day', async () => {
    await callPayload(createInvoice(null));

    expect(fakes.profiles.findEffective).toHaveBeenCalledWith(
      company.id,
      'tenant-1',
      '2026-10-13',
    );
  });

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

describe('NfseWorkflowService preparedDps from the fiscal snapshot', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const company = {
    id: 'company-1',
    taxId: '11222333000181',
    legalName: 'Empresa Teste',
    municipalReg: '123',
    municipalityCode: '3550308',
  };
  const REQUIRED: Obligation = { status: 'REQUIRED' };
  const na = (reason: string): Obligation => ({
    status: 'NOT_APPLICABLE',
    reason,
  });

  const classification = (): ServiceTaxClassification => ({
    serviceCode: '010601',
    municipalServiceCode: null,
    nbsCode: '010601001',
    cst: '000',
    classCode: '060101',
    operationIndicator: '000000',
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
  });

  const applicability = (): TaxApplicability => ({
    strategy: 'regular',
    customerRequired: true,
    iss: REQUIRED,
    issWithheld: na('no ISS withholding configured'),
    federalWithholding: na('NONE_CONFIRMED policy'),
    cbs: REQUIRED,
    ibs: REQUIRED,
    specialTreatment: na('no special treatment'),
    collectionWaived: false,
    rulesVersion: '2026.10-r1',
    legalReferences: ['LC 214/2025', 'LC 116/2003'],
  });

  const calculationResult = (): FiscalCalculationResult => ({
    operationId: 'inv-fiscal',
    companyId: company.id,
    competenceDate: '2026-10-13',
    taxRegime: 'LUCRO_PRESUMIDO',
    profileId: 'cfp-1',
    classification: classification(),
    taxableAmounts: { gross: '1000.00', discount: '0.00' },
    taxes: { iss: { base: '1000.00', rate: '3', amount: '30.00' } },
    withholdings: [],
    netReceivableAmount: '970.00',
    applicability: applicability(),
    collectionWaived: false,
    calculationSource: 'legacy',
    calculatorVersion: null,
    catalogVersions: { nbs: '2026.1' },
    rulesVersion: '2026.10-r1',
    legalReferences: ['LC 116/2003'],
    warnings: [],
    requiresReview: false,
    trace: [],
    calculationMemory: [],
  });

  const fiscalSnapshot = (invoiceId: string): FiscalSnapshot => ({
    id: 'snapshot-1',
    invoiceId,
    tenantId,
    companyId: company.id,
    taxRegime: 'LUCRO_PRESUMIDO',
    profileId: 'cfp-1',
    serviceProfileId: 'sp-1',
    specialTaxRegime: null,
    attempt: 1,
    calculationVersion: '2026.10-r1',
    grossAmount: '1000.00',
    discountAmount: '0.00',
    issAmount: '30.00',
    cbsAmount: null,
    ibsTotalAmount: null,
    netReceivableAmount: '970.00',
    result: calculationResult(),
    calculatedAt: new Date('2026-10-13T12:00:00.000Z'),
  });

  const createInvoice = (
    customer: CustomerSnapshot | null = {
      taxId: '12345678000195',
      name: 'Cliente Teste LTDA',
    },
  ): Invoice =>
    Invoice.create(
      {
        companyId: company.id,
        customer,
        service: {
          description: 'Consultoria em TI',
          code: '010601',
          municipalityCode: '3550308',
        },
        amount: 1000,
        competenceDate: new Date('2026-10-13'),
      },
      tenantId,
    );

  const issueResult = {
    success: true,
    accessKey: '43144000000000000000000000000000000000000000000000',
    nfseNumber: 7,
    xmlAuthorized:
      '<?xml version="1.0" encoding="UTF-8"?><NFSe><infNFSe Id="NFS1"/></NFSe>',
    requiresReconciliation: false,
  };

  const fakes = {
    invoices: { findByIdAndTenantId: jest.fn(), save: jest.fn() },
    sequences: { reserveNext: jest.fn() },
    companies: { findById: jest.fn() },
    certificates: { decryptCredentials: jest.fn() },
    providers: { resolve: jest.fn() },
    lifecycle: { transition: jest.fn() },
    queues: { add: jest.fn() },
    webhooks: { findByTenantIdAndEvent: jest.fn() },
    outbox: { enqueue: jest.fn() },
    documentStorage: { saveXml: jest.fn() },
    profiles: { findEffective: jest.fn() },
    fiscalSnapshots: { findByInvoiceId: jest.fn() },
    config: { getOrThrow: jest.fn() },
  };
  type WorkflowArgs = ConstructorParameters<typeof NfseWorkflowService>;
  let service: NfseWorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    fakes.invoices.save.mockResolvedValue(undefined);
    fakes.companies.findById.mockResolvedValue(company);
    fakes.sequences.reserveNext.mockResolvedValue({ series: '1', number: 7 });
    fakes.profiles.findEffective.mockResolvedValue({
      taxRegime: 'LUCRO_PRESUMIDO',
      specialTaxRegime: null,
    });
    fakes.certificates.decryptCredentials.mockResolvedValue({
      pfxBuffer: Buffer.alloc(0),
      password: '',
    });
    fakes.lifecycle.transition.mockResolvedValue(undefined);
    fakes.queues.add.mockResolvedValue({
      id: 'job-id',
      queueName: 'queue',
      jobName: 'job',
    });
    fakes.webhooks.findByTenantIdAndEvent.mockResolvedValue([]);
    fakes.outbox.enqueue.mockResolvedValue(undefined);
    fakes.documentStorage.saveXml.mockResolvedValue(undefined);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(null);
    fakes.config.getOrThrow.mockReturnValue({ dpsLayout: 'rtc-v1.01' });
    const args: WorkflowArgs = [
      fakes.invoices,
      fakes.sequences,
      fakes.companies,
      fakes.certificates,
      fakes.providers,
      fakes.lifecycle,
      fakes.queues,
      fakes.webhooks,
      fakes.outbox,
      fakes.documentStorage,
      fakes.profiles,
      fakes.fiscalSnapshots,
      new DpsBuilder(),
      fakes.config,
    ] as unknown as WorkflowArgs;
    service = new NfseWorkflowService(...args);
  });

  const callPayload = (invoice: Invoice): Promise<IIssuePayload> =>
    (
      service as unknown as {
        payload: (i: Invoice) => Promise<IIssuePayload>;
      }
    ).payload(invoice);

  const processInvoice = (invoice: Invoice): Promise<void> =>
    service.process({
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      companyId: invoice.companyId,
    });

  const spyOnReject = () =>
    jest.spyOn(
      service as unknown as {
        rejectBeforeProcessing: (
          i: Invoice,
          code: string,
          message: string,
        ) => Promise<void>;
      },
      'rejectBeforeProcessing',
    );

  it('builds preparedDps from the latest fiscal snapshot and keeps the legacy payload', async () => {
    const invoice = createInvoice();
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );

    const payload = await callPayload(invoice);

    expect(fakes.fiscalSnapshots.findByInvoiceId).toHaveBeenCalledWith(
      invoice.id,
      tenantId,
    );
    expect(fakes.config.getOrThrow).toHaveBeenCalledWith('rtc');
    expect(payload.preparedDps).toBeDefined();
    expect(payload.preparedDps?.infDPS.IBSCBS).toBeDefined();
    expect(payload.number).toBe(7);
    expect(payload.serie).toBe('1');
    expect(payload.emitente.cnpj).toBe(company.taxId);
    expect(payload.servico).toEqual({
      cTribNac: '010601',
      descricao: 'Consultoria em TI',
      codMunicipioPrestacao: '3550308',
    });
    expect(payload.valores).toEqual({ vServ: 1000 });
    expect(payload.tomador).toEqual({
      documento: { CNPJ: '12345678000195' },
      nome: 'Cliente Teste LTDA',
    });
  });

  it('hands preparedDps to the fiscal provider and enqueues the reconciliation', async () => {
    const invoice = createInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );
    const issueMock = jest.fn().mockResolvedValue(issueResult);
    fakes.providers.resolve.mockReturnValue({ issue: issueMock });

    await processInvoice(invoice);

    expect(issueMock).toHaveBeenCalledTimes(1);
    const issued = issueMock.mock.calls[0][0] as IIssuePayload;
    expect(issued.preparedDps).toBeDefined();
    expect(issued.preparedDps?.infDPS.IBSCBS).toBeDefined();
    expect(issued.emitente.cnpj).toBe(company.taxId);
    expect(issued.valores).toEqual({ vServ: 1000 });
    expect(issued.tomador?.documento).toEqual({ CNPJ: '12345678000195' });
    expect(fakes.queues.add).toHaveBeenCalledWith(
      'nfse-fiscal-reconcile',
      'reconcile',
      {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        tenantId: invoice.tenantId,
      },
      expect.objectContaining({
        idempotencyKey: `fiscal-reconcile:${invoice.id}`,
      }),
    );
  });

  it('rejects a queued invoice with the reason when the emission job exhausted its retries', async () => {
    const invoice = createInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    await service.handleEmissionExhausted(
      { invoiceId: invoice.id, tenantId: invoice.tenantId },
      new Error('The specified bucket does not exist'),
    );

    expect(invoice.status).toBe('rejected');
    expect(invoice.toSnapshot().lastErrorCode).toBe(
      'EMISSION_PROCESSING_FAILED',
    );
    expect(invoice.toSnapshot().lastErrorMessage).toContain(
      'The specified bucket does not exist',
    );
    expect(fakes.providers.resolve).not.toHaveBeenCalled();
  });

  it('sends a processing invoice to reconciliation instead of declaring it failed', async () => {
    const invoice = createInvoice();
    invoice.setProcessing();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    await service.handleEmissionExhausted(
      { invoiceId: invoice.id, tenantId: invoice.tenantId },
      new Error('storage unavailable'),
    );

    expect(invoice.status).toBe('reconciliation_required');
    expect(fakes.queues.add).toHaveBeenCalledWith(
      'nfse-reconciliation',
      'reconcile',
      expect.objectContaining({ invoiceId: invoice.id }),
      expect.anything(),
    );
  });

  it('leaves an already final invoice untouched when the job exhausted its retries', async () => {
    const invoice = createInvoice();
    invoice.setProcessing();
    invoice.transitionTo('authorized');
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    await service.handleEmissionExhausted(
      { invoiceId: invoice.id, tenantId: invoice.tenantId },
      new Error('late failure'),
    );

    expect(invoice.status).toBe('authorized');
    expect(fakes.lifecycle.transition).not.toHaveBeenCalled();
  });

  it('rejects before processing when the builder fails with DPS_LAYOUT_UNSUPPORTED and never issues', async () => {
    const invoice = createInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );
    fakes.config.getOrThrow.mockReturnValue({ dpsLayout: 'rtc-v1.99' });
    fakes.providers.resolve.mockReturnValue({ issue: jest.fn() });
    const rejectSpy = spyOnReject();

    await processInvoice(invoice);

    expect(rejectSpy).toHaveBeenCalledWith(
      invoice,
      'DPS_LAYOUT_UNSUPPORTED',
      expect.any(String),
    );
    expect(fakes.providers.resolve).not.toHaveBeenCalled();
    expect(fakes.lifecycle.transition).toHaveBeenCalledTimes(1);
    expect(invoice.status).toBe('rejected');
    expect(invoice.toSnapshot().lastErrorCode).toBe('DPS_LAYOUT_UNSUPPORTED');
    // The reserved number is already persisted and stays with the invoice.
    expect(fakes.invoices.save).toHaveBeenCalledTimes(1);
    expect(fakes.invoices.save).toHaveBeenCalledWith(invoice, tenantId);
    expect(invoice.dpsNumber).toBe(7);
    expect(invoice.toSnapshot().dpsSeries).toBe('1');
    expect(recordDpsValidationFailure).toHaveBeenCalledWith(
      'DPS_LAYOUT_UNSUPPORTED',
    );
    expect(recordAuthorizationFailure).not.toHaveBeenCalled();
  });

  it('counts a permanent Sefin rejection as an authorization failure', async () => {
    const invoice = createInvoice();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );
    fakes.providers.resolve.mockReturnValue({
      issue: jest.fn().mockResolvedValue({
        success: false,
        requiresReconciliation: false,
        errorCode: 'E0001',
        errorMessage: 'Rejected by Sefin',
      }),
    });

    await processInvoice(invoice);

    expect(recordAuthorizationFailure).toHaveBeenCalledWith('E0001');
    expect(recordDpsValidationFailure).not.toHaveBeenCalled();
    expect(invoice.status).toBe('rejected');
    expect(invoice.toSnapshot().lastErrorCode).toBe('E0001');
  });

  it('keeps the legacy flow byte-identical when no snapshot exists', async () => {
    const invoice = createInvoice({ taxId: '52998224725', name: 'Ana' });
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);

    const payload = await callPayload(invoice);

    expect(fakes.fiscalSnapshots.findByInvoiceId).toHaveBeenCalledWith(
      invoice.id,
      tenantId,
    );
    expect(payload).not.toHaveProperty('preparedDps');
    expect(fakes.config.getOrThrow).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      invoiceId: invoice.id,
      tenantId,
      number: 7,
      serie: '1',
      environment: 'test',
      emitente: {
        cnpj: company.taxId,
        legalName: 'Empresa Teste',
        municipalReg: '123',
        codMunicipio: '3550308',
        regime: { opSimpNac: 1, regApTribSN: 1, regEspTrib: 0 },
      },
      servico: {
        cTribNac: '010601',
        descricao: 'Consultoria em TI',
        codMunicipioPrestacao: '3550308',
      },
      valores: { vServ: 1000 },
      tomador: { documento: { CPF: '52998224725' }, nome: 'Ana' },
    });
  });
});
