import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAgent } from 'undici';
import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import { TableAuthorityEndpointResolver } from './endpoints';
import { loadCertificate } from './certificate-loader';
import {
  buildEnvelope,
  extractSoapResult,
  SefazSoapClient,
  sefazAgentOptions,
  type SoapLogEntry,
} from './soap-client';

const endpoint = new TableAuthorityEndpointResolver().resolve({
  uf: 'SP',
  tpAmb: 2,
  model: 55,
  tpEmis: 1,
  service: 'NfeStatusServico',
});
const url = new URL(endpoint.url);

const RESULT =
  '<retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><cStat>107</cStat></retConsStatServ>';
const SOAP_RESPONSE = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">${RESULT}</nfeResultMsg></soap:Body></soap:Envelope>`;

function setup() {
  const { pfx, password } = makeTestA1({ cnpj: '11222333000181' });
  const certificate = loadCertificate(pfx, password);
  const agent = new MockAgent();
  agent.disableNetConnect();
  const logs: SoapLogEntry[] = [];
  const client = new SefazSoapClient({
    dispatcherFor: () => agent,
    logger: (e) => logs.push(e),
  });
  const pool = agent.get(url.origin);
  const call = () =>
    client.call({
      endpoint,
      bodyXml: '<consStatServ versao="4.00"/>',
      certificate,
      timeoutMs: 1000,
    });
  return { pool, call, logs, agent };
}

describe('SefazSoapClient', () => {
  it('returns the content of nfeResultMsg on 200', async () => {
    const { pool, call } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(200, SOAP_RESPONSE);
    const result = await call();
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.bodyXml).toBe(RESULT);
  });

  it('sends a SOAP 1.2 envelope with the action in the content type', async () => {
    const { pool, call } = setup();
    let captured: { headers: unknown; body: unknown } | undefined;
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(200, (opts) => {
        captured = { headers: opts.headers, body: opts.body };
        return SOAP_RESPONSE;
      });
    await call();
    const headers = captured?.headers as Record<string, string>;
    expect(headers['content-type']).toBe(
      `application/soap+xml; charset=utf-8; action="${endpoint.soapAction}"`,
    );
    expect(String(captured?.body)).toContain(
      '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4"><consStatServ versao="4.00"/></nfeDadosMsg>',
    );
    expect(String(captured?.body)).toContain(
      'http://www.w3.org/2003/05/soap-envelope',
    );
  });

  it('turns a timeout after sending into uncertain', async () => {
    const { pool, call } = setup();
    pool.intercept({ path: url.pathname, method: 'POST' }).replyWithError(
      Object.assign(new Error('headers timeout'), {
        code: 'UND_ERR_HEADERS_TIMEOUT',
      }),
    );
    expect(await call()).toEqual({ kind: 'uncertain', reason: 'timeout' });
  });

  it('turns a refused connection into unavailable', async () => {
    const { pool, call } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .replyWithError(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      );
    expect(await call()).toEqual({ kind: 'unavailable' });
  });

  it('reads the code of a wrapped cause (undici wraps connect errors)', async () => {
    const { pool, call } = setup();
    pool.intercept({ path: url.pathname, method: 'POST' }).replyWithError(
      Object.assign(new Error('fetch failed'), {
        cause: Object.assign(new Error('dns'), { code: 'ENOTFOUND' }),
      }),
    );
    expect(await call()).toEqual({ kind: 'unavailable' });
  });

  it('turns a reset after sending into uncertain network', async () => {
    const { pool, call } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .replyWithError(
        Object.assign(new Error('socket'), { code: 'UND_ERR_SOCKET' }),
      );
    expect(await call()).toEqual({ kind: 'uncertain', reason: 'network' });
  });

  it('turns 503 into uncertain server', async () => {
    const { pool, call } = setup();
    pool.intercept({ path: url.pathname, method: 'POST' }).reply(503, 'down');
    expect(await call()).toEqual({ kind: 'uncertain', reason: 'server' });
  });

  it('turns 4xx into unavailable', async () => {
    const { pool, call } = setup();
    pool.intercept({ path: url.pathname, method: 'POST' }).reply(403, 'no');
    expect(await call()).toEqual({ kind: 'unavailable' });
  });

  it('treats a 200 without a result as uncertain', async () => {
    const { pool, call } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(200, '<html>proxy page</html>');
    expect(await call()).toEqual({ kind: 'uncertain', reason: 'server' });
  });

  it('logs only authority, service, duration, status and outcome', async () => {
    const { pool, call, logs } = setup();
    pool
      .intercept({ path: url.pathname, method: 'POST' })
      .reply(200, SOAP_RESPONSE);
    await call();
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0]).sort()).toEqual(
      ['authority', 'durationMs', 'httpStatus', 'outcome', 'service'].sort(),
    );
    expect(logs[0]).toMatchObject({
      authority: 'SP',
      service: 'NFeStatusServico4',
      httpStatus: 200,
    });
  });
});

describe('extractSoapResult', () => {
  it('unwraps a per-method wrapper', () => {
    const xml = `<soap:Envelope xmlns:soap="x"><soap:Body><nfeStatusServicoNFResult>${RESULT}</nfeStatusServicoNFResult></soap:Body></soap:Envelope>`;
    expect(extractSoapResult(xml)).toBe(RESULT);
  });

  it('returns null for a SOAP fault', () => {
    const xml =
      '<soap:Envelope xmlns:soap="x"><soap:Body><soap:Fault><soap:Reason>x</soap:Reason></soap:Fault></soap:Body></soap:Envelope>';
    expect(extractSoapResult(xml)).toBeNull();
  });
});

describe('buildEnvelope', () => {
  it('drops the XML declaration of the body', () => {
    const envelope = buildEnvelope(
      'urn:x',
      '<?xml version="1.0"?><consStatServ/>',
    );
    expect(envelope.match(/<\?xml/g)).toHaveLength(1);
  });
});

describe('source guard', () => {
  it('never disables server certificate verification', () => {
    const source = readFileSync(join(__dirname, 'soap-client.ts'), 'utf8');
    expect(source).not.toMatch(/rejectUnauthorized\s*:\s*false/);
    expect(source).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
  });
});

describe('sefazAgentOptions', () => {
  it('talks HTTP/1.1 only: the SEFAZ breaks on HTTP/2 (undici 8 tries it by default)', () => {
    const options = sefazAgentOptions({ keyPem: 'k', certPem: 'c' }, 5000);
    expect(options.allowH2).toBe(false);
    expect(options.connect).toMatchObject({
      ALPNProtocols: ['http/1.1'],
      rejectUnauthorized: true,
      timeout: 5000,
    });
  });
});
