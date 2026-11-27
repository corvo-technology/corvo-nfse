import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { GOV_FISCAL_HOSTS, probeViaProxy } from './gov-proxy';

const SCRIPT = join(
  __dirname,
  '../../../../../scripts/gov-proxy/gov-proxy.mjs',
);
const AUTH = `Basic ${Buffer.from('corvo:segredo').toString('base64')}`;

/** The default list of the stand-alone proxy must be exactly the API allowlist. */
describe('scripts/gov-proxy/gov-proxy.mjs', () => {
  it('has the same default hosts as the API allowlist', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const block = /const DEFAULT_HOSTS = \[([\s\S]*?)\]\.join/.exec(source);
    const hosts = [...(block?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(hosts)).toEqual(GOV_FISCAL_HOSTS);
  });

  describe('running', () => {
    let child: ChildProcess;
    const port = 40_000 + Math.floor(Math.random() * 10_000);

    beforeAll(async () => {
      child = spawn(process.execPath, [SCRIPT], {
        env: {
          ...process.env,
          PROXY_USER: 'corvo',
          PROXY_PASS: 'segredo',
          PORT: String(port),
          HOST: '127.0.0.1',
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.stdout?.on('data', (chunk: Buffer) => {
          if (String(chunk).includes('listening')) resolve();
        });
      });
    });

    afterAll(() => {
      child.kill();
    });

    const connect = (target: string, auth?: string): Promise<number> =>
      new Promise((resolve) => {
        const req = request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: target,
          headers: auth ? { 'proxy-authorization': auth } : {},
        });
        req.once('connect', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        req.once('error', () => resolve(0));
        req.end();
      });

    it('asks for credentials', async () => {
      expect(await connect('sefin.nfse.gov.br:443')).toBe(407);
    });

    it('refuses hosts and ports outside the allowlist', async () => {
      expect(await connect('example.com:443', AUTH)).toBe(403);
      expect(await connect('evil.nfse.gov.br:443', AUTH)).toBe(403);
      expect(await connect('sefin.nfse.gov.br:22', AUTH)).toBe(403);
    });

    it('the API probe through it answers false for a refused credential', async () => {
      await expect(
        probeViaProxy(
          `http://corvo:errada@127.0.0.1:${port}`,
          'sefin.nfse.gov.br',
          3_000,
        ),
      ).resolves.toBe(false);
    });
  });
});

describe('probeViaProxy with a proxy that accepts', () => {
  it('opens the tunnel with the credentials and reports true', async () => {
    const seen: string[] = [];
    const proxy = createServer();
    proxy.on('connect', (req, socket) => {
      seen.push(`${req.url} ${req.headers['proxy-authorization']}`);
      socket.end('HTTP/1.1 200 Connection Established\r\n\r\n');
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    const { port } = proxy.address() as AddressInfo;
    await expect(
      probeViaProxy(
        `http://corvo:segredo@127.0.0.1:${port}`,
        'sefin.nfse.gov.br',
      ),
    ).resolves.toBe(true);
    expect(seen).toEqual([`sefin.nfse.gov.br:443 ${AUTH}`]);
    await new Promise((r) => proxy.close(r));
  });
});
