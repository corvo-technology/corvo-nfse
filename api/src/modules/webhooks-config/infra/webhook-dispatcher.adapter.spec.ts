import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import {
  WebhookDeliveryHttpError,
  WebhookDispatcherAdapter,
} from './webhook-dispatcher.adapter';
import { WebhookValidationError } from '../domain/errors';
import { WebhookEvent } from '../domain/webhook-event';

jest.mock('node:dns', () => ({
  ...jest.requireActual<typeof import('node:dns')>('node:dns'),
  lookup: jest.fn(),
}));

const event = { id: 'evt', environment: 'test' } as unknown as WebhookEvent;

// Test-only adapter that skips the address check, so a local server can stand in for a public host.
class PermissiveAdapter extends WebhookDispatcherAdapter {
  protected override readonly lookup = ((
    _host: string,
    options: { all?: boolean },
    cb: (e: null, a: unknown, f?: number) => void,
  ) =>
    options.all
      ? cb(null, [{ address: '127.0.0.1', family: 4 }])
      : cb(null, '127.0.0.1', 4)) as never;
}

describe('WebhookDispatcherAdapter', () => {
  let server: Server;
  let port: number;
  let seen: { method?: string; sig?: string; body: string } | undefined;
  let respond: (res: import('node:http').ServerResponse) => void;

  beforeEach(async () => {
    seen = undefined;
    respond = (res) => res.writeHead(204).end();
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen = {
          method: req.method,
          sig: String(req.headers['x-corvo-signature']),
          body,
        };
        respond(res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('posts the signed event and reports the status', async () => {
    const adapter = new PermissiveAdapter();
    await expect(
      adapter.send(`http://hook.example:${port}/x`, event, 'abc'),
    ).resolves.toEqual({ statusCode: 204 });
    expect(seen).toMatchObject({ method: 'POST', sig: 'sha256=abc' });
    expect(JSON.parse(seen!.body)).toMatchObject({ id: 'evt' });
  });

  it('does not follow a redirect to an internal address (3xx fails the delivery)', async () => {
    let hits = 0;
    const internal = createServer((_q, res) => {
      hits++;
      res.writeHead(200).end();
    });
    await new Promise<void>((r) => internal.listen(0, '127.0.0.1', r));
    const internalPort = (internal.address() as AddressInfo).port;
    respond = (res) =>
      res
        .writeHead(307, { Location: `http://127.0.0.1:${internalPort}/` })
        .end();

    await expect(
      new PermissiveAdapter().send(
        `http://hook.example:${port}/x`,
        event,
        'abc',
      ),
    ).rejects.toMatchObject({ statusCode: 307 });
    expect(hits).toBe(0);
    await new Promise<void>((r) => internal.close(() => r()));
  });

  it('rejects a literal private IP without connecting', async () => {
    await expect(
      new WebhookDispatcherAdapter().send(
        `http://127.0.0.1:${port}/x`,
        event,
        'abc',
      ),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    await expect(
      new WebhookDispatcherAdapter().send(
        `http://[::ffff:7f00:1]:${port}/x`,
        event,
        'abc',
      ),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    expect(seen).toBeUndefined();
  });

  it('refuses a hostname that resolves to a private address at connect time (DNS rebinding)', async () => {
    (dnsLookup as unknown as jest.Mock).mockImplementation(
      (_h: string, _o: unknown, cb: (e: null, a: unknown[]) => void) =>
        cb(null, [{ address: '10.0.0.5', family: 4 }]),
    );
    await expect(
      new WebhookDispatcherAdapter().send(
        `http://rebind.example:${port}/x`,
        event,
        'abc',
      ),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    expect(seen).toBeUndefined();
  });

  it('maps non-2xx responses to WebhookDeliveryHttpError', async () => {
    respond = (res) => res.writeHead(500).end();
    await expect(
      new PermissiveAdapter().send(
        `http://hook.example:${port}/x`,
        event,
        'abc',
      ),
    ).rejects.toBeInstanceOf(WebhookDeliveryHttpError);
  });
});
