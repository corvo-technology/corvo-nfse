import type { INestApplication } from '@nestjs/common';
import {
  GLOBAL_PREFIX_EXCLUDES,
  configureHttpGlobalPrefix,
  emptyBodyProbe,
  inboundRawBody,
} from './bootstrap-http';

describe('configureHttpGlobalPrefix', () => {
  it('applies the API prefix to every route', () => {
    const app = {
      setGlobalPrefix: jest.fn(),
      use: jest.fn(),
    } as unknown as INestApplication;

    configureHttpGlobalPrefix(app, 'v1');

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('v1', {
      exclude: GLOBAL_PREFIX_EXCLUDES,
    });
    expect(GLOBAL_PREFIX_EXCLUDES).toEqual(
      expect.arrayContaining([
        '/.well-known/mcp.json',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-authorization-server',
      ]),
    );
  });
});

describe('inboundRawBody', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express') as typeof import('express');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const request = require('supertest') as typeof import('supertest');

  function app() {
    // nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage -- test-only app that checks the raw-body middleware; it never serves a browser session
    const server = express();
    server.use(inboundRawBody());
    server.use(express.json());
    server.post('/v1/integrations/inbound/:id', (req, res) => {
      res.json({
        isBuffer: Buffer.isBuffer(req.body),
        length: (req.body as Buffer).length,
      });
    });
    server.post('/v1/other', (_req, res) => res.json({ ok: true }));
    return server;
  }

  it('keeps an unparseable body on the inbound route so the connector decides what to do', async () => {
    const res = await request(app())
      .post('/v1/integrations/inbound/abc')
      .set('Content-Type', 'application/json')
      .send('{ not json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isBuffer: true, length: 10 });
  });

  it('keeps bodies of any content type on the inbound route', async () => {
    const res = await request(app())
      .post('/v1/integrations/inbound/abc')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=1');
    expect(res.body).toEqual({ isBuffer: true, length: 3 });
  });

  it('refuses a body above 256 KB with 413', async () => {
    const res = await request(app())
      .post('/v1/integrations/inbound/abc')
      .set('Content-Type', 'application/json')
      .send('x'.repeat(256 * 1024 + 1));
    expect(res.status).toBe(413);
  });

  it('does not touch other routes: invalid JSON is still rejected by the JSON parser', async () => {
    const res = await request(app())
      .post('/v1/other')
      .set('Content-Type', 'application/json')
      .send('{ not json');
    expect(res.status).toBe(400);
  });
});

describe('emptyBodyProbe', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express') as typeof import('express');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const http = require('http') as typeof import('http');

  function send(
    port: number,
    headers: Record<string, string>,
    chunks: string[],
  ): Promise<{ emptyBody: unknown }> {
    return new Promise((resolve, reject) => {
      // nosemgrep: problem-based-packs.insecure-transport.js-node.using-http-server.using-http-server -- loopback test server, no TLS needed
      const req = http.request(
        { port, method: 'POST', path: '/x', headers },
        (res) => {
          let data = '';
          res.on('data', (c: Buffer) => (data += c.toString()));
          res.on('end', () => resolve(JSON.parse(data) as never));
        },
      );
      req.on('error', reject);
      chunks.forEach((c) => req.write(c));
      req.end();
    });
  }

  async function run(
    headers: Record<string, string>,
    chunks: string[],
  ): Promise<unknown> {
    // nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage -- test-only app
    const server = express();
    server.use(emptyBodyProbe());
    server.use(express.json());
    server.post('/x', (req, res) => {
      res.json({ emptyBody: (req as { emptyBody?: boolean }).emptyBody });
    });
    const listener = server.listen(0);
    try {
      const { port } = listener.address() as { port: number };
      return (await send(port, headers, chunks)).emptyBody;
    } finally {
      listener.close();
    }
  }

  it('flags a chunked request with zero bytes as empty', async () => {
    expect(await run({ 'Transfer-Encoding': 'chunked' }, [])).toBe(true);
  });

  it('flags a chunked request with bytes as not empty', async () => {
    expect(await run({ 'Transfer-Encoding': 'chunked' }, ['a=1'])).toBe(false);
  });

  it('does not probe requests that declare a content type', async () => {
    expect(
      await run(
        { 'Transfer-Encoding': 'chunked', 'Content-Type': 'application/json' },
        ['{}'],
      ),
    ).toBeUndefined();
  });
});
