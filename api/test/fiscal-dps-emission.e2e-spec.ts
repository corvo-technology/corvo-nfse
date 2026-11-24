/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import forge from 'node-forge';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  Ambiente,
  NfseClient,
  NotFoundError,
  TimeoutError,
  parseNfseXml,
  type DPS,
  type RetryStore,
} from 'open-nfse';
import { NfseClientFake, synthChaveAcesso, synthNfse } from 'open-nfse/testing';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { OpenNfseProvider } from '@/infra/external/nfse/open-nfse.provider';
import type { IIssuePayload } from '@/infra/external/nfse/nfse-fiscal-provider';
import {
  DpsBuilder,
  type DpsBuildInput,
} from '@/modules/invoice/domain/fiscal/dps/dps-builder';
import { reconcile } from '@/modules/invoice/domain/fiscal/reconciliation/reconcile';
import type { FiscalCalculationResult } from '@/modules/invoice/domain/fiscal/fiscal-calculation-result';
import { toDecimal } from '@/modules/invoice/domain/fiscal/money';

// Disable the manual SDK mocks used by the default unit suite.
jest.unmock('open-nfse');
jest.unmock('open-nfse/testing');

// `open-nfse` bundles its own undici; resolve dispatcher and transport error
// classes through the SDK so `instanceof` checks inside the client agree with
// the classes we raise here (e.g. HeadersTimeoutError -> TimeoutError).
// Jest's resolver applies moduleNameMapper even to `createRequire().resolve`,
// so name-based resolution hands back the hoisted undici while open-nfse uses
// its bundled copy internally; a version-mismatched dispatcher breaks dispatch
// (requests hang or fail with "invalid onError method"). Resolve the SDK's
// bundled undici by explicit path so dispatcher and transport error classes
// share the instance the client itself uses.
const sdkUndiciPath = `${process.cwd()}/node_modules/open-nfse/node_modules/undici/index.js`;
const { MockAgent, errors: undiciErrors } = existsSync(sdkUndiciPath)
  ? (createRequire(sdkUndiciPath)('./index.js') as typeof import('undici'))
  : (createRequire(process.cwd() + '/package.json')(
      'undici',
    ) as typeof import('undici'));

const SEFIN_ORIGIN = 'https://sefin.nfse.gov.br';
const SEFIN_POST = '/SefinNacional/nfse';
const EMITENTE_CNPJ = '11222333000181';
const MUNICIPIO = '3550308';
const SERIE = '1';
const DPS_NUMBER = 7;
const RTC_V1_01 = 'rtc-v1.01';
const TENANT = randomUUID();
const COMPANY = randomUUID();
const INVOICE = randomUUID();

const gzipB64 = (xml: string): string =>
  Buffer.from(gzipSync(Buffer.from(xml))).toString('base64');
const stripXmlDeclaration = (xml: string): string =>
  xml.replace(/<\?xml[^?]*\?>\s*/, '');
const postedXml = (body: unknown): string => {
  const raw =
    typeof body === 'string'
      ? (JSON.parse(body) as { dpsXmlGZipB64: string })
      : (body as { dpsXmlGZipB64: string });
  return gunzipSync(Buffer.from(raw.dpsXmlGZipB64, 'base64')).toString();
};

/**
 * Authorized NFS-e fixture that `parseNfseXml` accepts: the signed DPS travels
 * inside `<infNFSe>` and a direct `<IBSCBS>` child carries the consolidated
 * totals the fiscal reconciliation compares. The amounts mirror the local
 * fiscal snapshot below so the reconciliation outcome is `matched`.
 */
const authorizedNfseXml = (
  chave: string,
  signedDpsXml: string,
): string => `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${chave}">
<xLocEmi>SAO PAULO</xLocEmi><xLocPrestacao>SAO PAULO</xLocPrestacao><nNFSe>${DPS_NUMBER}</nNFSe><xTribNac>Consultoria fiscal</xTribNac><verAplic>sefin-test</verAplic><ambGer>1</ambGer><tpEmis>1</tpEmis><cStat>100</cStat><dhProc>${new Date('2026-10-14T12:00:00Z').toISOString()}</dhProc><nDFSe>${DPS_NUMBER}</nDFSe>
<emit><CNPJ>${EMITENTE_CNPJ}</CNPJ><xNome>Empresa de prova</xNome><enderNac><xLgr>Rua Prova</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>${MUNICIPIO}</cMun><UF>SP</UF><CEP>00000000</CEP></enderNac></emit>
<valores><vServ>1000.00</vServ><vBC>1000.00</vBC><pAliqAplic>3</pAliqAplic><vISSQN>30.00</vISSQN><vLiq>970.00</vLiq></valores>
<IBSCBS><cLocalidadeIncid>${MUNICIPIO}</cLocalidadeIncid><xLocalidadeIncid>SAO PAULO</xLocalidadeIncid><valores><vBC>1000.00</vBC><uf><pIBSUF>0.1</pIBSUF><pAliqEfetUF>0.1</pAliqEfetUF></uf><mun><pIBSMun>0</pIBSMun><pAliqEfetMun>0</pAliqEfetMun></mun><fed><pCBS>0.9</pCBS><pAliqEfetCBS>0.9</pAliqEfetCBS></fed></valores><totCIBS><vTotNF>1000.00</vTotNF><gIBS><vIBSTot>1.00</vIBSTot><gIBSUFTot><vIBSUF>1.00</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot></gIBS><gCBS><vCBS>9.00</vCBS></gCBS></totCIBS></IBSCBS>
${stripXmlDeclaration(signedDpsXml)}</infNFSe>
<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#NFS${chave}"><DigestValue>S</DigestValue></Reference></SignedInfo><SignatureValue>S</SignatureValue><KeyInfo><X509Data><X509Certificate>S</X509Certificate></X509Data></KeyInfo></Signature></NFSe>`;

/** Local fiscal snapshot whose amounts reconcile `matched` with the fixture. */
const localCalculation: FiscalCalculationResult = {
  operationId: INVOICE,
  companyId: COMPANY,
  competenceDate: '2026-10-01',
  taxRegime: 'LUCRO_PRESUMIDO',
  profileId: 'cfp-proof',
  classification: {
    serviceCode: '010601',
    municipalServiceCode: null,
    nbsCode: '115011000',
    cst: '000',
    classCode: '000001',
    operationIndicator: '100301',
    source: 'company_service_profile',
    serviceProfileId: 'sp-proof',
    operationNature: 'SERVICE',
    iss: {
      taxation: 'NORMAL',
      rate: '3',
      withholdingDefault: false,
      incidenceMunicipalityCode: MUNICIPIO,
    },
    withholding: { policy: 'NONE_CONFIRMED', rates: {} },
    catalogVersions: { nbs: '2026.1' },
    catalogValidated: true,
    justification: 'company service profile',
  },
  taxableAmounts: { gross: '1000.00', discount: '0.00', ibsCbs: '1000.00' },
  taxes: {
    iss: { base: '1000.00', rate: '3', amount: '30.00' },
    cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
    ibsState: { base: '1000.00', rate: '0.1', amount: '1.00' },
    ibsCity: { base: '1000.00', rate: '0', amount: '0.00' },
    ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
  },
  withholdings: [],
  netReceivableAmount: '970.00',
  applicability: {
    strategy: 'regular',
    customerRequired: true,
    iss: { status: 'REQUIRED' },
    issWithheld: {
      status: 'NOT_APPLICABLE',
      reason: 'no ISS withholding configured',
    },
    federalWithholding: {
      status: 'NOT_APPLICABLE',
      reason: 'NONE_CONFIRMED policy',
    },
    cbs: { status: 'REQUIRED' },
    ibs: { status: 'REQUIRED' },
    specialTreatment: {
      status: 'NOT_APPLICABLE',
      reason: 'no special treatment',
    },
    collectionWaived: false,
    rulesVersion: '2026.10-r1',
    legalReferences: ['LC 214/2025', 'LC 116/2003'],
  },
  collectionWaived: false,
  calculationSource: 'legacy',
  calculatorVersion: null,
  catalogVersions: { nbs: '2026.1' },
  rulesVersion: '2026.10-r1',
  legalReferences: ['LC 216/2025', 'LC 116/2003'],
  warnings: [],
  requiresReview: false,
  trace: [],
  calculationMemory: [],
};

const buildInput = (): DpsBuildInput => ({
  result: localCalculation,
  invoice: {
    number: String(DPS_NUMBER),
    serie: SERIE,
    issuedAt: '2026-10-14T12:00:00.000Z',
    competenceDate: '2026-10-01',
    description: 'Consultoria fiscal',
    municipalityCode: MUNICIPIO,
    environment: 'live',
    customer: {
      kind: 'CNPJ',
      taxId: '12345678000195',
      name: 'Cliente Prova LTDA',
    },
    discountAmount: '0.00',
  },
  emitente: {
    cnpj: EMITENTE_CNPJ,
    municipalReg: '12345',
    municipalityCode: MUNICIPIO,
    specialTaxRegime: null,
    simplesIssRate: null,
  },
});

const dpsFrom = (built: Awaited<ReturnType<DpsBuilder['build']>>): DPS => {
  if (!built.ok) {
    throw new Error(
      `expected a DPS, got ${built.error.code}: ${built.error.message}`,
    );
  }
  return built.value;
};

interface ProviderClientInternals {
  client(payload: IIssuePayload, retryStore?: RetryStore): NfseClient;
}

interface PendingEmissionRecord {
  readonly id?: string;
  readonly idDps?: string;
  readonly xmlAssinado?: string;
  readonly attempts?: number;
  readonly notBefore?: string;
}

interface PendingEmissionRow {
  readonly pending_emission: PendingEmissionRecord | null;
  readonly dps_id: string | null;
}

describe('Ready DPS emission through OpenNfseProvider (preparedDps)', () => {
  const pfxPassword = 'prepared-dps-pfx-password';
  let db: DataSource;
  let provider: OpenNfseProvider;
  let preparedDps: DPS;
  let pfx: Buffer;
  let transport: InstanceType<typeof MockAgent>;
  let emitirDpsProntaCalls: jest.SpiedFunction<NfseClient['emitirDpsPronta']>;

  const payload = (overrides: Partial<IIssuePayload> = {}): IIssuePayload => ({
    invoiceId: INVOICE,
    tenantId: TENANT,
    number: DPS_NUMBER,
    competenceDate: new Date('2026-10-01T12:00:00Z'),
    issuedAt: new Date('2026-10-14T12:00:00Z'),
    pfxBuffer: pfx,
    p12Password: pfxPassword,
    environment: 'live',
    emitente: {
      cnpj: EMITENTE_CNPJ,
      legalName: 'Empresa de prova',
      municipalReg: '12345',
      codMunicipio: MUNICIPIO,
      regime: { opSimpNac: 2, regApTribSN: 1, regEspTrib: 0 },
    },
    serie: SERIE,
    servico: { cTribNac: '010101', descricao: 'Consultoria fiscal' },
    valores: { vServ: 1000 },
    preparedDps,
    ...overrides,
  });

  const sefin = () => transport.get(SEFIN_ORIGIN);

  interface HttpReply {
    readonly statusCode: number;
    readonly data: string;
  }

  const posts: string[] = [];
  const recordPosts = (reply: () => HttpReply) => {
    sefin()
      .intercept({ method: 'POST', path: SEFIN_POST })
      .reply((options: { body?: string }) => {
        posts.push(postedXml(options.body));
        return reply();
      });
  };
  const authorizedReply = (chave: string) => (): HttpReply => ({
    statusCode: 201,
    data: JSON.stringify({
      chaveAcesso: chave,
      idDps: preparedDps.infDPS.Id,
      nfseXmlGZipB64: gzipB64(
        authorizedNfseXml(chave, posts[posts.length - 1]),
      ),
      tipoAmbiente: 1,
      versaoAplicativo: 'sefin-test',
      dataHoraProcessamento: new Date().toISOString(),
    }),
  });
  const preparedDpsSignedXml = async (): Promise<string> => {
    const stored = (await pendingRow()).pending_emission?.xmlAssinado;
    if (stored === undefined || stored === null)
      throw new Error('expected a persisted signed DPS');
    return stored;
  };

  const pendingRow = async (): Promise<PendingEmissionRow> => {
    const rows = await db.query<PendingEmissionRow[]>(
      `SELECT pending_emission, dps_id FROM "${process.env.DB_SCHEMA}".nfse_invoices WHERE id = $1`,
      [INVOICE],
    );
    return rows[0];
  };
  const clearPendingEmission = async (): Promise<void> => {
    await db.query(
      `UPDATE "${process.env.DB_SCHEMA}".nfse_invoices SET pending_emission = NULL, dps_id = NULL WHERE id = $1`,
      [INVOICE],
    );
  };
  const respondStatus = (chave: string | null) => {
    const interceptor = sefin().intercept({
      method: 'GET',
      path: `/SefinNacional/dps/${preparedDps.infDPS.Id}`,
    });
    if (chave === null) {
      interceptor.reply(404, '{}');
      return;
    }
    interceptor.reply(
      200,
      JSON.stringify({
        chaveAcesso: chave,
        idDps: preparedDps.infDPS.Id,
        tipoAmbiente: 1,
        versaoAplicativo: 'sefin-test',
        dataHoraProcessamento: new Date().toISOString(),
      }),
    );
  };
  const respondAuthorizedQuery = async (chave: string): Promise<void> => {
    const signedXml = await preparedDpsSignedXml();
    sefin()
      .intercept({ method: 'GET', path: `/SefinNacional/nfse/${chave}` })
      .reply(
        200,
        JSON.stringify({
          chaveAcesso: chave,
          nfseXmlGZipB64: gzipB64(authorizedNfseXml(chave, signedXml)),
          tipoAmbiente: 1,
          versaoAplicativo: 'sefin-test',
          dataHoraProcessamento: new Date().toISOString(),
        }),
      );
  };
  /**
   * The POST reaches Sefin (its body is recorded) but the response never
   * arrives: the transport raises a headers timeout, leaving the DPS in an
   * indeterminate state that the next `issue` must resolve by status query.
   */
  const timeoutOnce = () => {
    sefin()
      .intercept({ method: 'POST', path: SEFIN_POST })
      .reply((options: { body?: string }) => {
        posts.push(postedXml(options.body));
        throw new undiciErrors.HeadersTimeoutError();
      });
  };

  beforeAll(async () => {
    const pool = {
      max: 3,
      min: 0,
      idleTimeoutMs: 30000,
      connectionTimeoutMs: 15000,
      maxLifetimeSeconds: 1800,
    };
    db = new DataSource(
      createTypeOrmOptions({
        url: process.env.DATABASE_URL ?? '',
        schema: process.env.DB_SCHEMA,
        ssl: false,
        logging: false,
        pool,
      }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${process.env.DB_SCHEMA}"`);
    await db.runMigrations();
    await db.query(
      `INSERT INTO "${process.env.DB_SCHEMA}".tenants(id) VALUES ($1)`,
      [TENANT],
    );
    await db.query(
      `INSERT INTO "${process.env.DB_SCHEMA}".nfse_companies(id,tenant_id,legal_name,tax_id,environment,status) VALUES ($1,$2,'Empresa de prova',$3,'live','ready')`,
      [COMPANY, TENANT, EMITENTE_CNPJ],
    );
    await db.query(
      `INSERT INTO "${process.env.DB_SCHEMA}".nfse_invoices(id,company_id,tenant_id,environment,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date) VALUES ($1,$2,$3,'live','queued','{}','{}','{}',1000,'2026-10-01')`,
      [INVOICE, COMPANY, TENANT],
    );
    preparedDps = dpsFrom(
      await new DpsBuilder().build(buildInput(), RTC_V1_01),
    );

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = keys.publicKey;
    certificate.serialNumber = '01';
    certificate.validity.notBefore = new Date(Date.now() - 60000);
    certificate.validity.notAfter = new Date(Date.now() + 86400000);
    certificate.setSubject([
      { name: 'commonName', value: `Empresa ${EMITENTE_CNPJ}` },
    ]);
    certificate.setIssuer(certificate.subject.attributes);
    certificate.sign(keys.privateKey, forge.md.sha256.create());
    pfx = Buffer.from(
      forge.asn1
        .toDer(
          forge.pkcs12.toPkcs12Asn1(
            keys.privateKey,
            [certificate],
            pfxPassword,
            {
              algorithm: '3des',
            },
          ),
        )
        .getBytes(),
      'binary',
    );

    provider = new OpenNfseProvider(db, new ConfigService());
    jest
      .spyOn(provider as unknown as ProviderClientInternals, 'client')
      .mockImplementation(
        (clientPayload, retryStore) =>
          new NfseClient({
            ambiente: Ambiente.Producao,
            certificado: {
              pfx: clientPayload.pfxBuffer,
              password: clientPayload.p12Password,
            },
            retryStore,
            dispatcher: transport,
          }),
      );
    emitirDpsProntaCalls = jest.spyOn(NfseClient.prototype, 'emitirDpsPronta');
  }, 90000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (transport !== undefined) await transport.close();
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${process.env.DB_SCHEMA}" CASCADE`);
      await db.destroy();
    }
  });

  beforeEach(async () => {
    transport = new MockAgent();
    transport.disableNetConnect();
    posts.length = 0;
    emitirDpsProntaCalls.mockClear();
    await clearPendingEmission();
  });

  it('signs the prepared DPS without transmitting and replays the persisted XML exactly once', async () => {
    const chave = synthChaveAcesso(21, EMITENTE_CNPJ);
    recordPosts(authorizedReply(chave));

    const result = await provider.issue(payload());

    expect(result.success).toBe(true);
    expect(result.requiresReconciliation).toBe(false);
    expect(result.accessKey).toBe(chave);
    // Exactly one POST: the dry-run sign transmits nothing and the pending
    // replay is the only transmission of the signed bytes.
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('<Signature');
    expect(result.xmlAuthorized).toContain('<IBSCBS');
    const row = await pendingRow();
    expect(row.pending_emission?.xmlAssinado).toBe(posts[0]);
    expect(row.pending_emission?.idDps).toBe(preparedDps.infDPS.Id);
    expect(row.dps_id).toBe(preparedDps.infDPS.Id);
    expect(emitirDpsProntaCalls).toHaveBeenCalledTimes(1);
  });

  it('the SDK fake signs in dryRun without registering any transmission', async () => {
    const fake = new NfseClientFake();
    const preview = await fake.emitirDpsPronta(preparedDps, { dryRun: true });

    expect(preview.dryRun).toBe(true);
    expect(preview.xmlDpsAssinado).toContain('<DPS');
    expect(fake.emittedChaves).toHaveLength(0);
    await expect(
      fake.fetchDpsStatus(preparedDps.infDPS.Id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a POST timeout leaves the invoice indeterminate and the next issue resolves via status query without a second transmission', async () => {
    timeoutOnce();

    const first = await provider.issue(payload());

    expect(first.success).toBe(false);
    expect(first.requiresReconciliation).toBe(true);
    expect(first.errorMessage).toContain('excedeu');
    const rowAfterTimeout = await pendingRow();
    expect(rowAfterTimeout.pending_emission?.idDps).toBe(preparedDps.infDPS.Id);
    expect(rowAfterTimeout.pending_emission?.attempts).toBe(2);
    expect(rowAfterTimeout.pending_emission?.xmlAssinado).toContain(
      '<Signature',
    );

    // The Receita authorized the DPS while the caller was away; the second
    // issue must resolve through the status query, never a resend.
    const chave = synthChaveAcesso(22, EMITENTE_CNPJ);
    respondStatus(chave);
    await respondAuthorizedQuery(chave);

    const second = await provider.issue(payload());

    expect(second.success).toBe(true);
    expect(second.requiresReconciliation).toBe(false);
    expect(second.accessKey).toBe(chave);
    expect(posts).toHaveLength(1);
    expect(emitirDpsProntaCalls).toHaveBeenCalledTimes(1);
  });

  it('after a timeout a NotFound status query resends the identical signed XML, never a new DPS number', async () => {
    timeoutOnce();

    const first = await provider.issue(payload());

    expect(first.success).toBe(false);
    expect(first.requiresReconciliation).toBe(true);

    const chave = synthChaveAcesso(23, EMITENTE_CNPJ);
    respondStatus(null);
    recordPosts(authorizedReply(chave));

    const second = await provider.issue(payload());

    expect(second.success).toBe(true);
    expect(second.accessKey).toBe(chave);
    expect(posts).toHaveLength(2);
    // Same infDPS.Id, same signature: the resend reuses the persisted XML.
    expect(posts[1]).toBe(posts[0]);
    const row = await pendingRow();
    expect(row.pending_emission?.xmlAssinado).toBe(posts[1]);
    expect(row.dps_id).toBe(preparedDps.infDPS.Id);
    expect(emitirDpsProntaCalls).toHaveBeenCalledTimes(1);
  });

  it('the SDK fake models the timeout as indeterminate until a status query resolves it', async () => {
    const fake = new NfseClientFake();
    fake.failNextEmit({ kind: 'transient' });

    await expect(fake.emitirDpsPronta(preparedDps)).rejects.toBeInstanceOf(
      TimeoutError,
    );
    await expect(
      fake.fetchDpsStatus(preparedDps.infDPS.Id),
    ).rejects.toBeInstanceOf(NotFoundError);

    // The fake authorizes the DPS while the caller was away; the query now
    // resolves the indeterminacy before any second send.
    const chave = synthChaveAcesso(24, EMITENTE_CNPJ);
    fake.seed.nfse(chave, {
      chaveAcesso: chave,
      idDps: preparedDps.infDPS.Id,
      xmlNfse: '<NFSe/>',
      nfse: synthNfse(preparedDps, chave, fake.ambiente),
      alertas: [],
      tipoAmbiente: fake.ambiente,
      versaoAplicativo: 'fake-seed',
      dataHoraProcessamento: new Date(),
    });

    const status = await fake.fetchDpsStatus(preparedDps.infDPS.Id);
    const byChave = await fake.fetchByChave(chave);
    expect(status.chaveAcesso).toBe(chave);
    expect(byChave.chaveAcesso).toBe(chave);
    expect(fake.emittedChaves).toEqual([chave]);
  });

  it('honors Retry-After on 429 and blocks retransmission until the window elapses', async () => {
    sefin()
      .intercept({ method: 'POST', path: SEFIN_POST })
      .reply(429, '{}', { headers: { 'retry-after': '120' } });
    const startedAt = Date.now();

    const first = await provider.issue(payload());

    expect(first.success).toBe(false);
    expect(first.requiresReconciliation).toBe(true);
    const row = await pendingRow();
    const notBefore = Date.parse(row.pending_emission?.notBefore ?? '');
    expect(notBefore).toBeGreaterThan(startedAt + 110000);
    expect(notBefore).toBeLessThan(startedAt + 130000);

    // Before the Retry-After window, a new issue must not transmit again.
    respondStatus(null);

    const second = await provider.issue(payload());

    expect(second.success).toBe(false);
    expect(second.requiresReconciliation).toBe(true);
    expect(second.errorMessage).toBe('Awaiting fiscal retry window');
    expect(posts).toHaveLength(0);
    expect(emitirDpsProntaCalls).toHaveBeenCalledTimes(1);
  });

  it('surfaces a permanent fiscal rejection with the SEFIN message and no reconciliation flag', async () => {
    sefin()
      .intercept({ method: 'POST', path: SEFIN_POST })
      .reply(
        400,
        JSON.stringify({
          mensagens: [
            { codigo: 'E0001', descricao: 'DPS rejeitada pela SEFIN' },
          ],
        }),
      );

    const result = await provider.issue(payload());

    expect(result.success).toBe(false);
    expect(result.requiresReconciliation).toBe(false);
    expect(result.errorCode).toBe('FISCAL_REJECTED');
    expect(result.errorMessage).toContain('E0001');
  });

  it('fails an XSD-invalid IBSCBS DPS before any transmission with INVALID_FISCAL_INPUT', async () => {
    const ibscbs = preparedDps.infDPS.IBSCBS;
    if (ibscbs === undefined)
      throw new Error('expected the prepared DPS to carry the IBSCBS group');
    const invalidDps: DPS = {
      ...preparedDps,
      infDPS: {
        ...preparedDps.infDPS,
        IBSCBS: {
          ...ibscbs,
          valores: {
            ...ibscbs.valores,
            trib: { gIBSCBS: { CST: 'ABC', cClassTrib: '000001' } },
          },
        },
      },
    };
    recordPosts(authorizedReply(synthChaveAcesso(25, EMITENTE_CNPJ)));

    const result = await provider.issue(payload({ preparedDps: invalidDps }));

    expect(result.success).toBe(false);
    expect(result.requiresReconciliation).toBe(false);
    expect(result.errorCode).toBe('INVALID_FISCAL_INPUT');
    expect(posts).toHaveLength(0);
  });

  it('reconciles the authorized IBSCBS XML against the local fiscal snapshot', async () => {
    const chave = synthChaveAcesso(26, EMITENTE_CNPJ);
    recordPosts(authorizedReply(chave));

    const result = await provider.issue(payload());

    expect(result.success).toBe(true);
    expect(result.xmlAuthorized).toBeDefined();
    if (result.xmlAuthorized === undefined)
      throw new Error('expected the authorized XML');
    const authorized = parseNfseXml(result.xmlAuthorized);
    expect(authorized.infNFSe.IBSCBS?.totCIBS.gCBS.vCBS).toBe(9);
    expect(authorized.infNFSe.DPS.infDPS.IBSCBS).toBeDefined();

    const outcome = reconcile(localCalculation, authorized, toDecimal('0.01'));

    expect(outcome.status).toBe('matched');
    expect(outcome.differences).toEqual([]);
  });
});
