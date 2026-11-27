/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '@nestjs/config';
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
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import { portalNfseXml } from '../domain/fiscal/__fixtures__/portal-nfse-xml';
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
      new InvoiceWebhookPublisher(webhooks as any, outbox as any),
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
    municipalRegForDps: '123',
    municipalityCode: '3550308',
  };
  const fakes = {
    invoices: {
      findByIdAndTenantId: jest.fn(),
      save: jest.fn(),
      saveDpsInfo: jest.fn(),
    },
    sequences: {
      reserveNext: jest.fn().mockResolvedValue({ series: '1', number: 7 }),
    },
    companies: { findById: jest.fn() },
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
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(null);
    fakes.config.getOrThrow.mockReturnValue({ dpsLayout: 'rtc-v1.01' });
    service = new NfseWorkflowService(
      fakes.invoices as any,
      fakes.sequences,
      fakes.companies as any,
      {} as any,
      { isSimulated: () => true } as any,
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

  it('uses the release instant as dhEmi for a scheduled invoice (Receita E0015)', async () => {
    const scheduledFor = new Date('2099-10-14T12:00:00.000Z');
    const invoice = Invoice.create(
      {
        companyId: 'company-1',
        customer: null,
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2099-10-14'),
        scheduledFor,
      },
      'tenant-1',
    );

    const payload = await callPayload(invoice);

    expect(payload.issuedAt).toEqual(scheduledFor);
  });

  it('refuses to build the DPS when the competence is after the issue day (E0015)', async () => {
    const invoice = Invoice.create(
      {
        companyId: 'company-1',
        customer: null,
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2099-10-14'),
      },
      'tenant-1',
    );

    await expect(callPayload(invoice)).rejects.toMatchObject({
      error: { code: 'COMPETENCE_DATE_IN_FUTURE' },
    });
  });

  it('keeps the creation time as dhEmi for an immediate invoice', async () => {
    const invoice = createInvoice(null);

    const payload = await callPayload(invoice);

    expect(payload.issuedAt).toEqual(invoice.toSnapshot().createdAt);
  });

  it('does not send the municipal registration unless the company opted in (Receita E0120)', async () => {
    fakes.companies.findById.mockResolvedValue({
      ...company,
      municipalReg: '123',
      municipalRegForDps: undefined,
    });
    const payload = await callPayload(createInvoice(null));
    expect(payload.emitente.municipalReg).toBeUndefined();
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
    municipalRegForDps: '123',
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
    amounts: { discount?: number; deduction?: number } = {},
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
        ...amounts,
        competenceDate: new Date('2026-10-13'),
      },
      tenantId,
    );

  const issueResult = {
    success: true,
    accessKey: '43144000000000000000000000000000000000000000000000',
    nfseNumber: 7,
    // The portal's note for this invoice's own DPS: checked against it before authorizing.
    xmlAuthorized: portalNfseXml({
      providerCnpj: company.taxId,
      customerCnpj: '12345678000195',
      amount: '1000.00',
      competenceDate: '2026-10-13',
      series: '1',
      number: 7,
      tpAmb: '2', // a test invoice goes to the Produção Restrita
    }),
    requiresReconciliation: false,
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
    providers: { resolve: jest.fn(), isSimulated: jest.fn() },
    lifecycle: { transition: jest.fn() },
    queues: { add: jest.fn() },
    webhooks: { findByTenantIdAndEvent: jest.fn() },
    outbox: { enqueue: jest.fn() },
    documentStorage: { saveXml: jest.fn() },
    profiles: { findEffective: jest.fn() },
    fiscalSnapshots: { findByInvoiceId: jest.fn() },
    config: { getOrThrow: jest.fn(), get: jest.fn() },
  };
  type WorkflowArgs = ConstructorParameters<typeof NfseWorkflowService>;
  let service: NfseWorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    fakes.invoices.save.mockResolvedValue(undefined);
    fakes.invoices.saveDpsInfo.mockResolvedValue(undefined);
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
    fakes.providers.isSimulated.mockReturnValue(false);
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
      new InvoiceWebhookPublisher(fakes.webhooks as any, fakes.outbox as any),
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

  it.each([
    ['restricted', '2'],
    [undefined, '1'],
  ])(
    'sends a live DPS with the environment of its target (%s => tpAmb %s)',
    async (target, tpAmb) => {
      const invoice = Invoice.create(
        {
          companyId: company.id,
          customer: {
            kind: 'CNPJ',
            taxId: '12345678000195',
            name: 'Cliente Teste LTDA',
          } as never,
          service: {
            description: 'Consultoria em TI',
            code: '010601',
            municipalityCode: '3550308',
          },
          amount: 1000,
          competenceDate: new Date('2026-10-13'),
          environment: 'live',
        },
        tenantId,
      );
      fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
        fiscalSnapshot(invoice.id),
      );
      fakes.config.get.mockReturnValue(target);

      const payload = await callPayload(invoice);

      expect(payload.preparedDps?.infDPS.tpAmb).toBe(tpAmb);
    },
  );

  it('a test invoice uses the company certificate and goes to the Sefin Produção Restrita', async () => {
    const invoice = createInvoice();
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );
    fakes.config.get.mockReturnValue(undefined);

    const payload = await callPayload(invoice);

    expect(fakes.certificates.decryptCredentials).toHaveBeenCalledWith(
      company.id,
      invoice.tenantId,
      'test',
    );
    expect(payload.preparedDps?.infDPS.tpAmb).toBe('2');
  });

  it('a test invoice needs no certificate while the simulator is on (CI and e2e)', async () => {
    const invoice = createInvoice();
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );
    fakes.providers.isSimulated.mockReturnValue(true);

    await callPayload(invoice);

    expect(fakes.certificates.decryptCredentials).not.toHaveBeenCalled();
  });

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

  it('sends the declared deduction in the preparedDps as vDedRed/vDR', async () => {
    const invoice = createInvoice(undefined, { deduction: 400 });
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );

    const payload = await callPayload(invoice);

    expect(payload.preparedDps?.infDPS.valores.vDedRed).toEqual({ vDR: 400 });
  });

  it('sends the unconditional discount in the preparedDps', async () => {
    const invoice = createInvoice(undefined, { discount: 50 });
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );

    const payload = await callPayload(invoice);

    expect(payload.preparedDps?.infDPS.valores.vDescCondIncond).toEqual({
      vDescIncond: 50,
    });
  });

  it('omits vDedRed when the invoice declares no deduction', async () => {
    const invoice = createInvoice();
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );

    const payload = await callPayload(invoice);

    expect(payload.preparedDps?.infDPS.valores.vDedRed).toBeUndefined();
  });

  it('rejects a declared deduction before processing when there is no fiscal snapshot and never issues', async () => {
    const invoice = createInvoice(undefined, { deduction: 400 });
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(null);
    fakes.providers.resolve.mockReturnValue({ issue: jest.fn() });
    const rejectSpy = spyOnReject();

    await processInvoice(invoice);

    expect(rejectSpy).toHaveBeenCalledWith(
      invoice,
      'FISCAL_VALIDATION_FAILED',
      expect.stringContaining('deduction'),
    );
    expect(fakes.providers.resolve).not.toHaveBeenCalled();
    expect(invoice.status).toBe('rejected');
  });

  const invoiceWithInfo = (): Invoice =>
    Invoice.create(
      {
        companyId: company.id,
        customer: { taxId: '12345678000195', name: 'Cliente Teste LTDA' },
        service: {
          description: 'Consultoria em TI',
          code: '010601',
          municipalityCode: '3550308',
          purchaseOrder: 'PO-4521',
          notes: 'Parcela 2 de 3',
        },
        amount: 1000,
        competenceDate: new Date('2026-10-13'),
      },
      tenantId,
    );

  it('sends the purchase order and the notes in the preparedDps as serv/infoCompl', async () => {
    const invoice = invoiceWithInfo();
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );

    const payload = await callPayload(invoice);

    expect(payload.preparedDps?.infDPS.serv.infoCompl).toEqual({
      xPed: 'PO-4521',
      xInfComp: 'Parcela 2 de 3',
    });
  });

  it('rejects complementary info when there is no fiscal snapshot instead of issuing without it', async () => {
    const invoice = invoiceWithInfo();
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(null);
    fakes.providers.resolve.mockReturnValue({ issue: jest.fn() });
    const rejectSpy = spyOnReject();

    await processInvoice(invoice);

    expect(rejectSpy).toHaveBeenCalledWith(
      invoice,
      'FISCAL_VALIDATION_FAILED',
      expect.stringContaining('purchaseOrder'),
    );
    expect(fakes.providers.resolve).not.toHaveBeenCalled();
  });

  const abroad = {
    name: 'Acme Inc.',
    foreign: {
      taxId: '12-3456789',
      country: 'US',
      postalCode: '94105',
      city: 'San Francisco',
      region: 'CA',
      street: '1 Market St',
      number: '100',
      district: 'SoMa',
    },
  };

  it('sends a customer abroad in the preparedDps as toma with NIF and the address abroad', async () => {
    const invoice = createInvoice(abroad);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(invoice.id),
    );

    const payload = await callPayload(invoice);

    expect(payload.preparedDps?.infDPS.toma).toMatchObject({
      identificador: { NIF: '12-3456789' },
      xNome: 'Acme Inc.',
      end: { localidade: { endExt: { cPais: 'US' } }, xBairro: 'SoMa' },
    });
  });

  it('rejects a customer abroad when there is no fiscal snapshot instead of issuing without the customer', async () => {
    const invoice = createInvoice(abroad);
    fakes.invoices.findByIdAndTenantId.mockResolvedValue(invoice);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(null);
    fakes.providers.resolve.mockReturnValue({ issue: jest.fn() });
    const rejectSpy = spyOnReject();

    await processInvoice(invoice);

    expect(rejectSpy).toHaveBeenCalledWith(
      invoice,
      'FISCAL_VALIDATION_FAILED',
      expect.stringContaining('customer.foreign'),
    );
    expect(fakes.providers.resolve).not.toHaveBeenCalled();
  });

  const ORIGINAL_KEY = '43144000000000000000000000000000000000000000000000';
  const authorizedOriginal = (): Invoice => {
    const original = createInvoice();
    original.transitionTo('processing');
    original.setAuthorized(ORIGINAL_KEY, 7);
    original.transitionTo('authorized');
    return original;
  };
  const substituteOf = (original: Invoice): Invoice =>
    Invoice.create(
      {
        companyId: company.id,
        customer: { taxId: '12345678000195', name: 'Cliente Teste LTDA' },
        service: {
          description: 'Consultoria em TI, outubro',
          code: '010601',
          municipalityCode: '3550308',
        },
        amount: 1000,
        competenceDate: new Date('2026-10-13'),
        substitution: {
          invoiceId: original.id,
          description: 'Descrição do serviço corrigida',
        },
      },
      tenantId,
    );
  const byId = (...known: Invoice[]) =>
    fakes.invoices.findByIdAndTenantId.mockImplementation((id: string) =>
      Promise.resolve(known.find((invoice) => invoice.id === id) ?? null),
    );

  it('sends the substitute with the subst group pointing at the original', async () => {
    const original = authorizedOriginal();
    const substitute = substituteOf(original);
    byId(original, substitute);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(substitute.id),
    );

    const payload = await callPayload(substitute);

    expect(payload.preparedDps?.infDPS.subst).toEqual({
      chSubstda: ORIGINAL_KEY,
      cMotivo: '99',
      xMotivo: 'Descrição do serviço corrigida',
    });
  });

  it('cancels the original only after the substitute is authorized, and tells the webhook', async () => {
    const original = authorizedOriginal();
    const substitute = substituteOf(original);
    byId(original, substitute);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(substitute.id),
    );
    const statusWhenIssued: string[] = [];
    fakes.providers.resolve.mockReturnValue({
      issue: jest.fn().mockImplementation(() => {
        statusWhenIssued.push(original.status);
        return Promise.resolve(issueResult);
      }),
    });

    await processInvoice(substitute);

    expect(statusWhenIssued).toEqual(['authorized']);
    expect(substitute.status).toBe('authorized');
    expect(original.status).toBe('cancelled');
    expect(original.cancellationReason).toEqual({
      code: 'other',
      description: `Substituída pela nota ${substitute.id}`,
    });
    expect(fakes.lifecycle.transition).toHaveBeenCalledWith(
      original,
      expect.objectContaining({
        fromStatus: 'authorized',
        toStatus: 'cancelled',
      }),
    );
  });

  it('leaves the original authorized when the Sefin refuses the substitute', async () => {
    const original = authorizedOriginal();
    const substitute = substituteOf(original);
    byId(original, substitute);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(substitute.id),
    );
    fakes.providers.resolve.mockReturnValue({
      issue: jest.fn().mockResolvedValue({
        success: false,
        errorCode: 'E0050',
        errorMessage: 'Substituição fora do prazo',
        requiresReconciliation: false,
      }),
    });

    await processInvoice(substitute);

    expect(original.status).toBe('authorized');
    expect(substitute.status).toBe('rejected');
  });

  it('refuses to send a substitute whose original is no longer authorized', async () => {
    const original = createInvoice();
    const substitute = substituteOf(original);
    byId(original, substitute);
    fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
      fiscalSnapshot(substitute.id),
    );
    fakes.providers.resolve.mockReturnValue({ issue: jest.fn() });
    const rejectSpy = spyOnReject();

    await processInvoice(substitute);

    expect(rejectSpy).toHaveBeenCalledWith(
      substitute,
      'FISCAL_VALIDATION_FAILED',
      expect.stringContaining('no longer authorized'),
    );
    expect(fakes.providers.resolve).not.toHaveBeenCalled();
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
    // createInvoice() makes a test invoice: its reconciliation runs on the test twin.
    expect(invoice.environment).toBe('test');
    expect(fakes.queues.add).toHaveBeenCalledWith(
      'nfse-reconciliation-test',
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
    // Persisted through the column-scoped saveDpsInfo (cancellation race fix).
    expect(fakes.invoices.saveDpsInfo).toHaveBeenCalledTimes(1);
    expect(fakes.invoices.saveDpsInfo).toHaveBeenCalledWith(invoice);
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

  describe('Simples totTrib', () => {
    const workflow = (
      totalRate: string | null,
      issRate: string | null = null,
    ) => {
      fakes.companies.findById.mockResolvedValue({
        ...company,
        simplesRate: totalRate ?? undefined,
        simplesIssRate: issRate ?? undefined,
      });
      return new NfseWorkflowService(
        fakes.invoices,
        fakes.sequences,
        fakes.companies,
        fakes.certificates,
        fakes.providers,
        fakes.lifecycle,
        fakes.queues,
        new InvoiceWebhookPublisher(fakes.webhooks as any, fakes.outbox as any),
        fakes.documentStorage,
        fakes.profiles,
        fakes.fiscalSnapshots,
        new DpsBuilder(),
        fakes.config,
      ) as unknown as {
        payload: (i: Invoice) => Promise<IIssuePayload>;
      };
    };
    const simplesSnapshot = (invoiceId: string) => {
      const snapshot = fiscalSnapshot(invoiceId);
      return {
        ...snapshot,
        taxRegime: 'SIMPLES_NACIONAL',
        result: { ...snapshot.result, taxRegime: 'SIMPLES_NACIONAL' },
      };
    };
    beforeEach(() => {
      fakes.profiles.findEffective.mockResolvedValue({
        taxRegime: 'SIMPLES_NACIONAL',
        specialTaxRegime: null,
        simplesIssRate: null,
        simplesApuracao: null,
      });
    });

    it('sends pTotTribSN from the rate of the company', async () => {
      const invoice = createInvoice();
      fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
        simplesSnapshot(invoice.id),
      );
      const payload = await workflow('6.54').payload(invoice);
      expect(payload.preparedDps?.infDPS.valores.trib.totTrib).toEqual({
        pTotTribSN: 6.54,
      });
    });

    it('uses the ISS rate of the company as the withholding aliquota', async () => {
      fakes.profiles.findEffective.mockResolvedValue({
        taxRegime: 'SIMPLES_NACIONAL',
        specialTaxRegime: null,
        simplesIssRate: '3.00',
        simplesApuracao: null,
      });
      const invoice = createInvoice();
      const snapshot = simplesSnapshot(invoice.id);
      snapshot.result.applicability = {
        ...snapshot.result.applicability,
        issWithheld: { status: 'REQUIRED' },
      };
      fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(snapshot);
      const payload = await workflow('6.54', '2.01').payload(invoice);
      expect(payload.preparedDps?.infDPS.valores.trib.tribMun.pAliq).toBe(2.01);
    });

    it('keeps the legacy totals when the company has no rate', async () => {
      const invoice = createInvoice();
      fakes.fiscalSnapshots.findByInvoiceId.mockResolvedValue(
        simplesSnapshot(invoice.id),
      );
      const payload = await workflow(null).payload(invoice);
      expect(payload.preparedDps?.infDPS.valores.trib.totTrib).toEqual({
        vTotTrib: { vTotTribFed: 0, vTotTribEst: 0, vTotTribMun: 0 },
      });
    });
  });
});
