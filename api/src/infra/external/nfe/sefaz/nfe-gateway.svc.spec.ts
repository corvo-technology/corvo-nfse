import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAgent } from 'undici';
import type { SigningContext } from '@/modules/fiscal-core/domain/ports/gateway.port';
import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from './certificate-loader';
import { TableAuthorityEndpointResolver } from './endpoints';
import { NfeGateway } from './nfe-gateway';
import { XmllintSchemaValidator } from './schema-validator';
import type { SignedNfe } from './signed-nfe';
import { SefazSoapClient } from './soap-client';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/nfe');
const soap = (name: string) =>
  readFileSync(join(FIXTURES, 'soap', `${name}.xml`), 'utf8');
const signedFixture = readFileSync(
  join(FIXTURES, 'xml', 'nfe-minimal-signed.xml'),
  'utf8',
).trim();
const BASE_KEY = '35261112345678000195550010000000011234567810';
/** Same note, with tpEmis (index 34 of the key) 6 = SVC-AN: SP is served by SVC-AN. */
const SVC_KEY = `${BASE_KEY.slice(0, 34)}6${BASE_KEY.slice(35)}`;

const resolver = new TableAuthorityEndpointResolver();
const svcUrl = (
  service: 'NfeAutorizacao' | 'NfeConsultaProtocolo' | 'NfeStatusServico',
) =>
  new URL(
    resolver.resolve({ uf: 'SP', tpAmb: 2, model: 55, tpEmis: 6, service }).url,
  );

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
    {},
    () => new Date('2026-11-26T13:00:00Z'),
    () => Promise.resolve(),
  );
  return { agent, gateway };
}

describe('NfeGateway on the SVC', () => {
  it('sends a note with tpEmis 6 in its key to the SVC-AN host', async () => {
    const { agent, gateway } = setup();
    const doc: SignedNfe = {
      accessKey: SVC_KEY,
      uf: 'SP',
      signedXml: signedFixture.replaceAll(BASE_KEY, SVC_KEY),
    };
    const svc = svcUrl('NfeAutorizacao');
    expect(svc.hostname).toBe('hom.svc.fazenda.gov.br');
    agent
      .get(svc.origin)
      .intercept({ path: svc.pathname, method: 'POST' })
      .reply(200, soap('ret-100'));
    const outcome = await gateway.issuer.issue(doc, ctx);
    expect(outcome.kind).toBe('ok');
  });

  it('consults a note with tpEmis 6 at the SVC', async () => {
    const { agent, gateway } = setup();
    const svc = svcUrl('NfeConsultaProtocolo');
    agent
      .get(svc.origin)
      .intercept({ path: svc.pathname, method: 'POST' })
      .reply(200, soap('ret-cons-100'));
    const outcome = await gateway.consult.consultByKey(SVC_KEY, ctx);
    expect(outcome.kind).toBe('ok');
  });

  it('does not fall back to the origin: with no SVC interceptor the call fails', async () => {
    const { gateway } = setup();
    const outcome = await gateway.consult.consultByKey(SVC_KEY, ctx);
    expect(outcome.kind).not.toBe('ok');
  });

  it('asks the status of the SVC when the target says tpEmis 6', async () => {
    const { agent, gateway } = setup();
    const svc = svcUrl('NfeStatusServico');
    agent
      .get(svc.origin)
      .intercept({ path: svc.pathname, method: 'POST' })
      .reply(
        200,
        `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4"><retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>SVC</verAplic><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T10:00:00-03:00</dhRecbto></retConsStatServ></nfeResultMsg></soap:Body></soap:Envelope>`,
      );
    expect(
      await gateway.serviceStatus.status({
        uf: 'SP',
        tpAmb: 2,
        certificate,
        tpEmis: 6,
      }),
    ).toEqual({ kind: 'ok', value: { up: true } });
  });
});
