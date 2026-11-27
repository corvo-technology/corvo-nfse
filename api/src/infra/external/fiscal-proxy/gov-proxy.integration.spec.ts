import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import { request } from 'undici';
import { buildGovProxyAgent } from './gov-proxy';

/** Real sockets: a tiny CONNECT proxy + a TLS server that REQUIRES a client certificate. */
describe('gov proxy: mTLS survives the CONNECT tunnel', () => {
  let dir: string;
  let server: https.Server;
  let proxy: http.Server;
  let serverPort: number;
  let proxyPort: number;
  const tunnelled: string[] = [];
  let sawClientCn: string | undefined;

  const openssl = (...args: string[]) =>
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gov-proxy-'));
    openssl(
      ...'req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost'.split(
        ' ',
      ),
    );
    openssl(
      ...'req -x509 -newkey rsa:2048 -nodes -keyout client.key -out client.crt -days 1 -subj /CN=empresa-a1'.split(
        ' ',
      ),
    );

    server = https.createServer(
      {
        key: read('server.key'),
        cert: read('server.crt'),
        requestCert: true,
        rejectUnauthorized: true,
        ca: read('client.crt'),
      },
      (req, res) => {
        sawClientCn = (
          req.socket as unknown as {
            getPeerCertificate: () => { subject: { CN: string } };
          }
        ).getPeerCertificate().subject.CN;
        res.end('ok');
      },
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    serverPort = (server.address() as AddressInfo).port;

    proxy = http.createServer();
    proxy.on('connect', (req, client, head) => {
      const [host, port] = (req.url ?? '').split(':');
      tunnelled.push(`${host}:${port}`);
      const up = net.connect(Number(port), '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.write(head);
        up.pipe(client);
        client.pipe(up);
      });
      up.on('error', () => client.destroy());
      client.on('error', () => up.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it('the server sees the client certificate through the tunnel', async () => {
    const agent = buildGovProxyAgent(
      `http://u:p@127.0.0.1:${proxyPort}`,
      { keyPem: read('client.key'), certPem: read('client.crt') },
      read('server.crt'),
    );
    const res = await request(`https://localhost:${serverPort}/`, {
      dispatcher: agent,
    });
    expect(await res.body.text()).toBe('ok');
    expect(tunnelled).toContain(`localhost:${serverPort}`);
    expect(sawClientCn).toBe('empresa-a1');
    await agent.close();
  });

  it('without the client certificate the server refuses, proving mTLS is end-to-end', async () => {
    const agent = buildGovProxyAgent(
      `http://u:p@127.0.0.1:${proxyPort}`,
      { keyPem: '', certPem: '' },
      read('server.crt'),
    );
    await expect(
      request(`https://localhost:${serverPort}/`, { dispatcher: agent }),
    ).rejects.toBeDefined();
    await agent.close();
  });
});
