import { MockAgent } from 'undici';
import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from './certificate-loader';
import { TableAuthorityEndpointResolver } from './endpoints';
import { SefazSoapClient } from './soap-client';

const CPF = '52998224725';
const endpoint = new TableAuthorityEndpointResolver().resolve({
  uf: 'SP',
  tpAmb: 2,
  model: 55,
  tpEmis: 1,
  service: 'NfeAutorizacao',
});
const url = new URL(endpoint.url);

const SIGNED_XML = `<enviNFe versao="4.00"><NFe><infNFe Id="NFe1"><dest><CPF>${CPF}</CPF></dest></infNFe></NFe></enviNFe>`;
const RESPONSE = `<soap:Envelope xmlns:soap="x"><soap:Body><nfeResultMsg><retEnviNFe><cStat>104</cStat><xMotivo>${CPF}</xMotivo></retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;

type Sink = 'log' | 'info' | 'warn' | 'error' | 'debug';
const SINKS: Sink[] = ['log', 'info', 'warn', 'error', 'debug'];

describe('SefazSoapClient does not leak', () => {
  const captured: string[] = [];
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    captured.length = 0;
    for (const sink of SINKS)
      spies.push(
        jest.spyOn(console, sink).mockImplementation((...args: unknown[]) => {
          captured.push(args.map(String).join(' '));
        }),
      );
    spies.push(
      jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        captured.push(String(chunk));
        return true;
      }),
      jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        captured.push(String(chunk));
        return true;
      }),
    );
  });
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

  async function run(reply: (pool: ReturnType<MockAgent['get']>) => void) {
    const { pfx, password } = makeTestA1({ cnpj: '11222333000181' });
    const certificate = loadCertificate(pfx, password);
    const agent = new MockAgent();
    agent.disableNetConnect();
    reply(agent.get(url.origin));
    // Default logger (console.debug) on purpose: that is what runs in production.
    const client = new SefazSoapClient({ dispatcherFor: () => agent });
    await client.call({
      endpoint,
      bodyXml: SIGNED_XML,
      certificate,
      timeoutMs: 500,
    });
    return certificate;
  }

  const assertClean = (certificate: { keyPem: string; certPem: string }) => {
    const all = captured.join('\n');
    expect(all).not.toContain(CPF);
    expect(all).not.toContain('PRIVATE KEY');
    expect(all).not.toContain(certificate.keyPem.split('\n')[1]);
    expect(all).not.toContain(certificate.certPem.split('\n')[1]);
    expect(all).not.toContain('<NFe');
    expect(all).not.toContain('<infNFe');
  };

  it('on success', async () => {
    const cert = await run((pool) =>
      pool
        .intercept({ path: url.pathname, method: 'POST' })
        .reply(200, RESPONSE),
    );
    expect(captured.length).toBeGreaterThan(0); // it did log something
    assertClean(cert);
  });

  it('on timeout', async () => {
    const cert = await run((pool) =>
      pool.intercept({ path: url.pathname, method: 'POST' }).replyWithError(
        Object.assign(new Error(`timeout ${CPF}`), {
          code: 'UND_ERR_HEADERS_TIMEOUT',
        }),
      ),
    );
    assertClean(cert);
  });

  it('on a server error that echoes the body', async () => {
    const cert = await run((pool) =>
      pool
        .intercept({ path: url.pathname, method: 'POST' })
        .reply(500, SIGNED_XML),
    );
    assertClean(cert);
  });
});
