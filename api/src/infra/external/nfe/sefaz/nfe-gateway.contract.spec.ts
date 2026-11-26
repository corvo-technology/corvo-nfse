import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAgent } from 'undici';
import type { SigningContext } from '@/modules/fiscal-core/domain/ports/gateway.port';
import { describeGatewayContract } from '@/modules/fiscal-core/testing/gateway-contract.suite';
import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from './certificate-loader';
import { TableAuthorityEndpointResolver } from './endpoints';
import { NfeGateway } from './nfe-gateway';
import { XmllintSchemaValidator } from './schema-validator';
import type {
  NfeAuthorization,
  NfeConsultResult,
  SignedNfe,
} from './signed-nfe';
import { SefazSoapClient } from './soap-client';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/nfe');
const soap = (name: string) =>
  readFileSync(join(FIXTURES, 'soap', `${name}.xml`), 'utf8');
const signedFixture = readFileSync(
  join(FIXTURES, 'xml', 'nfe-minimal-signed.xml'),
  'utf8',
).trim();
const BASE_KEY = '35261112345678000195550010000000011234567810';

/** The same valid NF-e under another key, so the mocked SEFAZ can tell the cases apart. */
function nfe(lastDigits: string): SignedNfe {
  const accessKey = BASE_KEY.slice(0, -lastDigits.length) + lastDigits;
  return {
    accessKey,
    uf: 'SP',
    signedXml: signedFixture.replaceAll(BASE_KEY, accessKey),
  };
}

const resolver = new TableAuthorityEndpointResolver();
const urlOf = (service: Parameters<typeof resolver.resolve>[0]['service']) =>
  new URL(
    resolver.resolve({ uf: 'SP', tpAmb: 2, model: 55, tpEmis: 1, service }).url,
  );

const authorizeUrl = urlOf('NfeAutorizacao');
const retAuthorizeUrl = urlOf('NfeRetAutorizacao');
const consultUrl = urlOf('NfeConsultaProtocolo');

const { pfx, password } = makeTestA1({ cnpj: '12345678000195' });
const certificate = loadCertificate(pfx, password);
const ctx: SigningContext = {
  certificate,
  tpAmb: 2,
  target: resolver.resolve({
    uf: 'SP',
    tpAmb: 2,
    model: 55,
    tpEmis: 1,
    service: 'NfeAutorizacao',
  }),
};

const AUTHORIZED = nfe('11');
const REJECTED = nfe('22');
const TIMEOUT = nfe('33');
const DENIED = nfe('44');
const DUPLICATE = nfe('55');
const LATER = nfe('66');
const DOWN = nfe('77');
const STUCK = nfe('88');

const slept: number[] = [];

function setup() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const gateway = new NfeGateway(
    new SefazSoapClient({
      dispatcherFor: () => agent,
      logger: () => undefined,
    }),
    resolver,
    new XmllintSchemaValidator(),
    1000,
    () => new Date('2026-11-26T13:00:00Z'),
    (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  );
  const authorize = agent.get(authorizeUrl.origin);
  const answerFor = (doc: SignedNfe) => (body: string) =>
    body.includes(`Id="NFe${doc.accessKey}"`);
  const on = (
    pool: ReturnType<typeof agent.get>,
    path: string,
    match: (body: string) => boolean,
    fixture: string,
    times = 1,
  ) =>
    pool
      .intercept({ path, method: 'POST', body: match })
      .reply(200, soap(fixture))
      .times(times);
  const authorization = (doc: SignedNfe, fixture: string, times = 1) =>
    on(authorize, authorizeUrl.pathname, answerFor(doc), fixture, times);
  return { agent, gateway, authorize, authorization, on };
}

describeGatewayContract(
  'NfeGateway (SEFAZ SOAP)',
  () => {
    const { agent, gateway, authorization } = setup();
    authorization(AUTHORIZED, 'ret-100');
    authorization(REJECTED, 'ret-225');
    authorization(DENIED, 'ret-302');
    agent
      .get(authorizeUrl.origin)
      .intercept({
        path: authorizeUrl.pathname,
        method: 'POST',
        body: (body) => body.includes(`Id="NFe${TIMEOUT.accessKey}"`),
      })
      .replyWithError(
        Object.assign(new Error('timeout'), {
          code: 'UND_ERR_HEADERS_TIMEOUT',
        }),
      );
    agent
      .get(consultUrl.origin)
      .intercept({ path: consultUrl.pathname, method: 'POST' })
      .reply(200, soap('ret-cons-100'))
      .persist();
    return gateway.asFiscalGateway();
  },
  {
    authorized: AUTHORIZED,
    rejected: REJECTED,
    timeout: TIMEOUT,
    denied: DENIED,
    consultKey: BASE_KEY,
    ctx,
  },
);

describe('NfeGateway authorization', () => {
  beforeEach(() => {
    slept.length = 0;
  });

  it('104 with protNFe 100 carries the protocol and the protNFe', async () => {
    const f = setup();
    f.authorization(AUTHORIZED, 'ret-100');
    const outcome = await f.gateway.issuer.issue(AUTHORIZED, ctx);
    expect(outcome.kind).toBe('ok');
    const value = (outcome as unknown as { value: NfeAuthorization }).value;
    expect(value).toMatchObject({
      protocol: '135260000000001',
      cStat: '100',
      accessKey: BASE_KEY,
    });
    expect(value.protNFeXml).toMatch(
      /^<protNFe xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="4\.00">/,
    );
    expect(value.protNFeXml).toContain('<nProt>135260000000001</nProt>');
    expect(value.authorizedAt.toISOString()).toBe('2026-11-26T13:00:05.000Z');
  });

  it('103 then the lot answer 100 is authorized, after waiting tMed', async () => {
    const f = setup();
    f.authorization(LATER, 'ret-103');
    f.on(
      f.agent.get(retAuthorizeUrl.origin),
      retAuthorizeUrl.pathname,
      (body) => body.includes('<nRec>351000000000001</nRec>'),
      'ret-retAut-100',
    );
    const outcome = await f.gateway.issuer.issue(LATER, ctx);
    expect(outcome.kind).toBe('ok');
    expect(slept).toEqual([1000]);
  });

  it('keeps asking at most 3 times while the lot is processing, then is uncertain', async () => {
    const f = setup();
    f.authorization(STUCK, 'ret-103');
    f.on(
      f.agent.get(retAuthorizeUrl.origin),
      retAuthorizeUrl.pathname,
      () => true,
      'ret-retAut-105',
      3,
    );
    const outcome = await f.gateway.issuer.issue(STUCK, ctx);
    expect(outcome).toEqual({ kind: 'uncertain', reason: 'server' });
    expect(slept).toHaveLength(3);
  });

  it('a denial (302) is denied, not rejected', async () => {
    const f = setup();
    f.authorization(DENIED, 'ret-302');
    expect(await f.gateway.issuer.issue(DENIED, ctx)).toMatchObject({
      kind: 'denied',
      code: '302',
    });
  });

  it('a lot rejection (225) is rejected with the code and a hint', async () => {
    const f = setup();
    f.authorization(REJECTED, 'ret-225');
    expect(await f.gateway.issuer.issue(REJECTED, ctx)).toMatchObject({
      kind: 'rejected',
      code: '225',
      hint: expect.stringContaining('schema'),
    });
  });

  it('a duplicate (204) is rejected 204, for the handler to consult', async () => {
    const f = setup();
    f.authorization(DUPLICATE, 'ret-204');
    expect(await f.gateway.issuer.issue(DUPLICATE, ctx)).toMatchObject({
      kind: 'rejected',
      code: '204',
    });
  });

  it('108 is unavailable', async () => {
    const f = setup();
    f.authorization(DOWN, 'ret-108');
    expect(await f.gateway.issuer.issue(DOWN, ctx)).toEqual({
      kind: 'unavailable',
    });
  });

  it('a signed XML that fails the XSD never reaches the SEFAZ', async () => {
    const f = setup();
    const broken = {
      ...AUTHORIZED,
      signedXml: AUTHORIZED.signedXml.replace('<mod>55</mod>', '<mod>99</mod>'),
    };
    const outcome = await f.gateway.issuer.issue(broken, ctx);
    expect(outcome).toMatchObject({ kind: 'rejected' });
  });

  it('sends one NF-e per lot with indSinc 1 and a 15-digit idLote', async () => {
    const f = setup();
    let seen = '';
    f.on(
      f.authorize,
      authorizeUrl.pathname,
      (body) => {
        seen = body;
        return true;
      },
      'ret-100',
    );
    await f.gateway.issuer.issue(AUTHORIZED, ctx);
    expect(seen).toContain('<indSinc>1</indSinc>');
    expect(seen).toMatch(/<idLote>\d{15}<\/idLote>/);
    expect(seen.match(/<NFe /g)).toHaveLength(1);
  });
});

describe('NfeGateway consultation', () => {
  const consult = async (fixture: string) => {
    const f = setup();
    f.on(
      f.agent.get(consultUrl.origin),
      consultUrl.pathname,
      () => true,
      fixture,
    );
    return f.gateway.consult.consultByKey(BASE_KEY, ctx);
  };

  it('authorized carries the authorization and the protNFe', async () => {
    const outcome = await consult('ret-cons-100');
    expect(outcome.kind).toBe('ok');
    const value = (outcome as unknown as { value: NfeConsultResult }).value;
    expect(value.status).toBe('authorized');
    expect(value.authorization).toMatchObject({
      protocol: '135260000000001',
      cStat: '100',
    });
    expect(value.events).toEqual([]);
  });

  it('217 is not_found, not an error', async () => {
    expect(await consult('ret-cons-217')).toMatchObject({
      kind: 'ok',
      value: { status: 'not_found', cStat: '217' },
    });
  });

  it('a cancellation event makes it cancelled and lists the event', async () => {
    const outcome = await consult('ret-cons-cancelled');
    const value = (outcome as unknown as { value: NfeConsultResult }).value;
    expect(value.status).toBe('cancelled');
    expect(value.events[0]).toMatchObject({
      tpEvento: '110111',
      nSeq: 1,
      protocol: '135260000000002',
    });
    expect(value.events[0].procEventoXml).toMatch(/^<procEventoNFe xmlns=/);
    expect(value.authorization?.protocol).toBe('135260000000001');
  });

  it('110 is denied', async () => {
    expect(await consult('ret-cons-denied')).toMatchObject({
      kind: 'ok',
      value: { status: 'denied' },
    });
  });

  it('108 is unavailable', async () => {
    expect(await consult('ret-cons-108')).toEqual({ kind: 'unavailable' });
  });

  it('a key of an unknown UF is a bug, not an outcome', async () => {
    const f = setup();
    await expect(
      f.gateway.consult.consultByKey(`99${BASE_KEY.slice(2)}`, ctx),
    ).rejects.toThrow('unknown cUF');
  });
});
