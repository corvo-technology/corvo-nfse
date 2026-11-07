import type { INestApplication } from '@nestjs/common';
import {
  GLOBAL_PREFIX_EXCLUDES,
  configureHttpGlobalPrefix,
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
