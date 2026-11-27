import { MockAgent, type Dispatcher } from 'undici';
import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from './certificate-loader';
import { TableAuthorityEndpointResolver } from './endpoints';
import { SefazSoapClient } from './soap-client';

const endpoint = new TableAuthorityEndpointResolver().resolve({
  uf: 'SP',
  tpAmb: 2,
  model: 55,
  tpEmis: 1,
  service: 'NfeStatusServico',
});
const url = new URL(endpoint.url);
const body = (cStat: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="x"><retConsStatServ><cStat>${cStat}</cStat></retConsStatServ></nfeResultMsg></soap:Body></soap:Envelope>`;

type ProxyFor = (
  host: string,
  proxied: Dispatcher,
) => Promise<Dispatcher | undefined>;

function setup(proxyFor: ProxyFor) {
  const { pfx, password } = makeTestA1({ cnpj: '11222333000181' });
  const certificate = loadCertificate(pfx, password);
  const direct = new MockAgent();
  const proxied = new MockAgent();
  for (const agent of [direct, proxied]) agent.disableNetConnect();
  direct
    .get(url.origin)
    .intercept({ path: url.pathname, method: 'POST' })
    .reply(200, body('107'));
  proxied
    .get(url.origin)
    .intercept({ path: url.pathname, method: 'POST' })
    .reply(200, body('108'));
  const hosts: string[] = [];
  const client = new SefazSoapClient({
    dispatcherFor: () => direct,
    proxyFor: (host) => {
      hosts.push(host);
      return proxyFor(host, proxied);
    },
    logger: () => undefined,
  });
  const call = () =>
    client.call({
      endpoint,
      bodyXml: '<consStatServ versao="4.00"/>',
      certificate,
      timeoutMs: 1000,
    });
  return { call, hosts };
}

const cStat = (r: { kind: string; bodyXml?: string }) =>
  /<cStat>(\d+)/.exec(r.bodyXml ?? '')?.[1];

describe('SefazSoapClient: backup route', () => {
  it('uses the proxy dispatcher when the selector returns one', async () => {
    const { call, hosts } = setup((_host, agent) => Promise.resolve(agent));
    expect(cStat(await call())).toBe('108');
    expect(hosts).toEqual([url.hostname]);
  });

  it('keeps the direct mTLS dispatcher when the selector says direct', async () => {
    const { call } = setup(() => Promise.resolve(undefined));
    expect(cStat(await call())).toBe('107');
  });

  it('goes direct when the selector fails', async () => {
    const { call } = setup(() => Promise.reject(new Error('redis down')));
    expect(cStat(await call())).toBe('107');
  });
});
