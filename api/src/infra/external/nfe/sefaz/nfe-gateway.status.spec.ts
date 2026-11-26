import { MockAgent } from 'undici';
import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from './certificate-loader';
import { TableAuthorityEndpointResolver } from './endpoints';
import { consStatServXml, NfeGateway } from './nfe-gateway';
import { XmllintSchemaValidator } from './schema-validator';
import { SefazSoapClient } from './soap-client';

const resolver = new TableAuthorityEndpointResolver();
const endpoint = resolver.resolve({
  uf: 'SP',
  tpAmb: 2,
  model: 55,
  tpEmis: 1,
  service: 'NfeStatusServico',
});
const url = new URL(endpoint.url);

const soapAnswer = (ret: string) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">${ret}</nfeResultMsg></soap:Body></soap:Envelope>`;

const ret = (cStat: string, xMotivo: string, extra = '') =>
  `<retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>SP_NFE_PL_009</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T10:00:00-03:00</dhRecbto>${extra}</retConsStatServ>`;

function setup() {
  const { pfx, password } = makeTestA1({ cnpj: '11222333000181' });
  const certificate = loadCertificate(pfx, password);
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
  );
  const target = { uf: 'SP' as const, tpAmb: 2 as const, certificate };
  return { pool: agent.get(url.origin), gateway, target };
}

describe('NfeGateway.serviceStatus', () => {
  it('cStat 107 is up', async () => {
    const { pool, gateway, target } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(
        200,
        soapAnswer(ret('107', 'Servico em Operacao', '<tMed>1</tMed>')),
      );
    expect(await gateway.serviceStatus.status(target)).toEqual({
      kind: 'ok',
      value: { up: true },
    });
  });

  it('cStat 108 is down, not an error', async () => {
    const { pool, gateway, target } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(200, soapAnswer(ret('108', 'Servico Paralisado Momentaneamente')));
    expect(await gateway.serviceStatus.status(target)).toEqual({
      kind: 'ok',
      value: { up: false },
    });
  });

  it('transport unavailable stays unavailable', async () => {
    const { pool, gateway, target } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .replyWithError(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      );
    expect(await gateway.serviceStatus.status(target)).toEqual({
      kind: 'unavailable',
    });
  });

  it('an answer without cStat is uncertain', async () => {
    const { pool, gateway, target } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(
        200,
        soapAnswer(
          '<retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe"/>',
        ),
      );
    expect(await gateway.serviceStatus.status(target)).toEqual({
      kind: 'uncertain',
      reason: 'server',
    });
  });

  it('queryStatus exposes cStat, xMotivo and tMed', async () => {
    const { pool, gateway, target } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(
        200,
        soapAnswer(ret('107', 'Servico em Operacao', '<tMed>2</tMed>')),
      );
    expect(await gateway.queryStatus(target)).toEqual({
      kind: 'ok',
      value: {
        up: true,
        cStat: '107',
        xMotivo: 'Servico em Operacao',
        tMed: '2',
      },
    });
  });

  it('sends a consStatServ that passes the XSD with the UF code', async () => {
    const xml = consStatServXml('SP', 2);
    expect(xml).toContain('<cUF>35</cUF>');
    expect(
      await new XmllintSchemaValidator().validate(xml, 'consStatServ'),
    ).toEqual({ ok: true });
  });
});
