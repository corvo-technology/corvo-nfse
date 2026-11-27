/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MonetizzeConnector } from './monetizze.connector';
import { readBody } from './monetizze.payload';
import {
  ConnectorDataError,
  type ConnectionView,
  type OperationDelivery,
} from '../../domain/connector';

type Json = Record<string, any>;

const file = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const fixture = (name: string) => file(`${name}.json`);
const edit = (name: string, change: (event: Json) => void) => {
  const event = JSON.parse(fixture(name)) as Json;
  change(event);
  return JSON.stringify(event);
};
const KEY = 'chave-unica-fake-0123456789abcdef';
const URL_SECRET = 'S3CRET-0123456789';
const connection = (invoiceValue?: string): ConnectionView => ({
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'monetizze:abc',
  credentials: {
    chaveUnica: KEY,
    webhookSecret: URL_SECRET,
    ...(invoiceValue ? { invoiceValue } : {}),
  },
});
const req = (body: string, over: { secret?: string | null } = {}) => ({
  rawBody: Buffer.from(body),
  headers: {},
  query:
    over.secret === null ? {} : { webhookSecret: over.secret ?? URL_SECRET },
});

const connector = new MonetizzeConnector();
const normalize = (body: string, conn = connection()) => {
  const delivery = connector.parse(req(body)) as OperationDelivery;
  return connector.normalize({ connection: conn, payload: body, delivery });
};

describe('MonetizzeConnector.authenticate', () => {
  const auth = (r: ReturnType<typeof req>) =>
    connector.authenticate(r, connection());

  it('accepts the right chave_unica with the right URL secret, in JSON and in form', async () => {
    await expect(auth(req(fixture('sale-approved')))).resolves.toEqual({
      ok: true,
    });
    await expect(auth(req(file('sale-approved.form')))).resolves.toEqual({
      ok: true,
    });
  });
  it('rejects a wrong or missing URL secret even with the right key', async () => {
    for (const secret of ['wrong', null])
      await expect(
        auth(req(fixture('sale-approved'), { secret })),
      ).resolves.toEqual({ ok: false, reason: 'bad_secret' });
  });
  it('rejects a wrong or missing chave_unica', async () => {
    await expect(
      auth(req(edit('sale-approved', (e) => (e.chave_unica = 'nope')))),
    ).resolves.toEqual({ ok: false, reason: 'bad_chave_unica' });
    await expect(
      auth(req(edit('sale-approved', (e) => delete e.chave_unica))),
    ).resolves.toEqual({ ok: false, reason: 'missing_chave_unica' });
  });
  it('rejects an unreadable body and a connection with no key stored', async () => {
    await expect(auth(req('{oops'))).resolves.toEqual({
      ok: false,
      reason: 'bad_body',
    });
    const conn = connection();
    delete conn.credentials.chaveUnica;
    await expect(
      connector.authenticate(req(fixture('sale-approved')), conn),
    ).resolves.toEqual({ ok: false, reason: 'bad_chave_unica' });
  });
});

describe('MonetizzeConnector.parse', () => {
  it('turns an approved sale into an operation, from JSON or form', () => {
    for (const body of [fixture('sale-approved'), file('sale-approved.form')])
      expect(connector.parse(req(body))).toEqual({
        kind: 'operation',
        deliveryId: '9000001:2',
        externalType: 'status_2',
      });
  });
  it('turns a completed sale and a refund into operations', () => {
    expect(
      connector.parse(
        req(edit('sale-approved', (e) => (e.venda.codigo_status = 6))),
      ),
    ).toMatchObject({ kind: 'operation', deliveryId: '9000001:6' });
    expect(connector.parse(req(fixture('sale-refunded')))).toMatchObject({
      kind: 'operation',
      deliveryId: '9000001:4',
    });
  });
  it.each([1, 3, 5, 8, 101])('ignores status %s', (status) => {
    const body = edit('sale-approved', (e) => {
      e.venda.codigo_status = status;
      delete e.tipoEvento;
    });
    expect(connector.parse(req(body))).toEqual({
      kind: 'ignored',
      externalType: `status_${status}`,
    });
  });
  it('reads the status from tipoEvento when the sale has no code', () => {
    const body = edit('sale-approved', (e) => delete e.venda.codigo_status);
    expect(connector.parse(req(body)).kind).toBe('operation');
  });
  it('ignores an abandoned checkout (no sale code)', () => {
    const body = edit('sale-approved', (e) => delete e.venda.codigo);
    expect(connector.parse(req(body))).toEqual({
      kind: 'ignored',
      externalType: 'no_sale',
    });
  });
  it.each([1, 4, 5, 7])('ignores the notice sent to role %s', (role) => {
    const body = edit('sale-approved', (e) => (e.tipoPostback.codigo = role));
    expect(connector.parse(req(body)).kind).toBe('ignored');
  });
  it('accepts a co-producer notice', () => {
    const body = edit('sale-approved', (e) => (e.tipoPostback.codigo = 3));
    expect(connector.parse(req(body)).kind).toBe('operation');
  });
  it('rejects a body that is not parseable JSON', () => {
    expect(() => connector.parse(req('{oops'))).toThrow(ConnectorDataError);
    expect(() => connector.parse(req(''))).toThrow(ConnectorDataError);
  });
});

describe('MonetizzeConnector.normalize', () => {
  it('maps an approved sale: key, buyer, address, product, total', async () => {
    const op = await normalize(fixture('sale-approved'));
    expect(op).toMatchObject({
      operationKey: 'monetizze:9000001',
      commercialState: 'paid',
      externalRefs: { venda: '9000001' },
      currency: 'BRL',
      amountCents: 9790,
      discountCents: 0,
      sellerIssuesInvoice: true,
      description: 'Curso de Exemplo',
      items: [
        {
          externalProductId: '4000001',
          description: 'Curso de Exemplo',
          quantity: 1,
        },
      ],
      customer: {
        name: 'Maria Compradora',
        email: 'maria@example.com',
        taxId: '52998224725',
        taxIdMasked: false,
        address: {
          street: 'Avenida Exemplo, 100 - Sala 2 - Centro',
          city: 'Sao Paulo',
          state: 'SP',
          zip: '01310100',
          country: 'Brasil',
        },
      },
    });
    expect(op.paidAt).toEqual(new Date('2026-11-26T15:00:00-03:00'));
    expect(op.paidAt).toEqual(op.occurredAt);
  });
  it('gives the same result from the form-encoded body', async () => {
    const json = await normalize(fixture('sale-approved'));
    const form = await normalize(file('sale-approved.form'));
    expect(form).toEqual(json);
  });
  it('"minha parte" uses venda.valorRecebido', async () => {
    const op = await normalize(fixture('sale-approved'), connection('mine'));
    expect(op.amountCents).toBe(7240);
  });
  it('"minha parte" without valorRecebido fails for manual completion', async () => {
    const body = edit('sale-approved', (e) => delete e.venda.valorRecebido);
    await expect(normalize(body, connection('mine'))).rejects.toThrow(
      ConnectorDataError,
    );
  });
  it.each(['0', '', 'abc'])('rejects a sale value of "%s"', async (value) => {
    const body = edit('sale-approved', (e) => (e.venda.valor = value));
    await expect(normalize(body)).rejects.toThrow(ConnectorDataError);
  });
  it('reads Brazilian-formatted amounts', async () => {
    const body = edit('sale-approved', (e) => (e.venda.valor = '1.457,00'));
    expect((await normalize(body)).amountCents).toBe(145700);
  });
  it('pads a CPF and a CNPJ that lost their leading zeros', async () => {
    const cpf = edit(
      'sale-approved',
      (e) => (e.comprador.cnpj_cpf = 1234567890),
    );
    expect((await normalize(cpf)).customer?.taxId).toBe('01234567890');
    const cnpj = edit(
      'sale-approved',
      (e) => (e.comprador.cnpj_cpf = '1.222.333/0001-81'),
    );
    expect((await normalize(cnpj)).customer?.taxId).toBe('01222333000181');
  });
  it('drops the tax ID of a foreign buyer and of nonsense', async () => {
    const foreign = edit(
      'sale-approved',
      (e) => (e.comprador.pais = 'Portugal'),
    );
    expect((await normalize(foreign)).customer?.taxId).toBeNull();
    const junk = edit('sale-approved', (e) => (e.comprador.cnpj_cpf = 'xx'));
    expect((await normalize(junk)).customer?.taxId).toBeNull();
  });
  it('has no customer when the buyer is not sent', async () => {
    const body = edit('sale-approved', (e) => delete e.comprador);
    expect((await normalize(body)).customer).toBeNull();
  });
  it('records the subscription code', async () => {
    const body = edit(
      'sale-approved',
      (e) => (e.assinatura = { codigo: 3184 }),
    );
    expect((await normalize(body)).externalRefs).toEqual({
      venda: '9000001',
      assinatura: '3184',
    });
  });
  it('maps a refund to refunded, pointing at the sale', async () => {
    const op = await normalize(fixture('sale-refunded'));
    expect(op).toMatchObject({
      operationKey: 'monetizze:9000001',
      commercialState: 'refunded',
      refersTo: { ref: 'venda', value: '9000001' },
      customer: null,
      paidAt: null,
    });
  });
  it('refuses to normalize an event it does not handle', async () => {
    const body = edit('sale-approved', (e) => (e.venda.codigo_status = 3));
    await expect(
      connector.normalize({
        connection: connection(),
        payload: body,
        delivery: { kind: 'operation', deliveryId: 'x', externalType: 'x' },
      }),
    ).rejects.toThrow(ConnectorDataError);
  });
});

describe('Monetizze form parsing', () => {
  it('ignores prototype-polluting keys', () => {
    const body = readBody(
      Buffer.from('__proto__[x]=1&a[constructor][y]=2&venda[codigo]=5'),
    );
    expect(({} as Json).x).toBeUndefined();
    expect(body.a).toBeUndefined();
    expect((body.venda as Json).codigo).toBe('5');
  });
});

describe('MonetizzeConnector.validateConnection', () => {
  it('derives a stable account id from the connection, not from the key', async () => {
    const a = await connector.validateConnection({ chaveUnica: 'k1' }, 'live', {
      publicId: 'pub',
    });
    const b = await connector.validateConnection({ chaveUnica: 'k2' }, 'live', {
      publicId: 'pub',
    });
    expect(a.externalAccountId).toMatch(/^monetizze:[0-9a-f]{24}$/);
    expect(a).toEqual(b);
  });
  it('refuses an empty key and an unknown option', async () => {
    await expect(
      connector.validateConnection({ chaveUnica: ' ' }, 'live', {
        publicId: 'p',
      }),
    ).rejects.toThrow(ConnectorDataError);
    await expect(
      connector.validateConnection(
        { chaveUnica: 'k', invoiceValue: 'half' },
        'live',
        { publicId: 'p' },
      ),
    ).rejects.toThrow(ConnectorDataError);
  });
});

describe('manifest', () => {
  it('asks for the key, generates the URL secret and offers the invoice value', () => {
    expect(connector.manifest.credentialFields).toEqual([
      { key: 'chaveUnica', label: 'Chave única', secret: true },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        secret: true,
        generate: true,
        inWebhookUrl: true,
      },
      expect.objectContaining({
        key: 'invoiceValue',
        optional: true,
        options: ['total', 'mine'],
      }),
    ]);
  });
});
