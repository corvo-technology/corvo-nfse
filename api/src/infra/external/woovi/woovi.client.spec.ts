import { BadGatewayException } from '@nestjs/common';
import { WooviClient } from './woovi.client';

const config = {
  enabled: true,
  appId: 'APP_ID_FIXTURE',
  webhookToken: 'token-token-token-token',
  apiUrl: 'https://api.woovi.test/api/v1',
};

function fetchReturning(status: number, body: unknown) {
  return jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('WooviClient', () => {
  it('creates a dynamic charge with the app id as Authorization and cents as value', async () => {
    const fetchFn = fetchReturning(200, {
      charge: {
        correlationID: 'c1',
        brCode: '000201...',
        qrCodeImage: 'data:image/png;base64,AAA',
        paymentLinkUrl: 'https://woovi.test/pay/c1',
      },
    });
    const client = new WooviClient(config, fetchFn as never);
    const charge = await client.createCharge({
      correlationID: 'c1',
      valueCents: 990,
      comment: 'Notas avulsas',
      expiresInSeconds: 86400,
    });
    expect(charge).toEqual({
      correlationID: 'c1',
      brCode: '000201...',
      qrCodeImage: 'data:image/png;base64,AAA',
      paymentLinkUrl: 'https://woovi.test/pay/c1',
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.woovi.test/api/v1/charge');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'APP_ID_FIXTURE',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      correlationID: 'c1',
      value: 990,
      comment: 'Notas avulsas',
      expiresIn: 86400,
    });
  });

  it('reads a charge back so a webhook can be double-checked', async () => {
    const fetchFn = fetchReturning(200, {
      charge: { correlationID: 'c1', status: 'COMPLETED', value: 990 },
    });
    const client = new WooviClient(config, fetchFn as never);
    await expect(client.getCharge('c 1')).resolves.toEqual({
      status: 'COMPLETED',
      value: 990,
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.woovi.test/api/v1/charge/c%201');
    expect(init.method).toBe('GET');
  });

  it('creates a monthly Pix Automático subscription the way Woovi expects it', async () => {
    const fetchFn = fetchReturning(200, {
      subscription: {
        correlationID: 's1',
        globalID: 'UGF5bWVudA==',
        status: 'ACTIVE',
        paymentLinkUrl: 'https://woovi.test/pay/s1',
        pixRecurring: { emv: '000201BRCODE', journey: 'PAYMENT_ON_APPROVAL' },
      },
    });
    const client = new WooviClient(
      config,
      fetchFn as never,
      () => new Date('2026-11-05T15:00:00Z'),
    );
    const customer = {
      name: 'Ana Souza',
      taxID: '12345678909',
      email: 'a@x.com',
      phone: '5511999999999',
      address: {
        zipcode: '04556300',
        street: 'Rua de São Paulo',
        number: '3432',
        neighborhood: 'Brooklin',
        city: 'São Paulo',
        state: 'SP',
      },
    };
    const sub = await client.createSubscription({
      correlationID: 's1',
      valueCents: 5990,
      comment: 'Corvo Solo (mensal)',
      customer,
    });
    expect(sub).toEqual({
      correlationID: 's1',
      providerId: 'UGF5bWVudA==',
      paymentLinkUrl: 'https://woovi.test/pay/s1',
      brCode: '000201BRCODE',
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.woovi.test/api/v1/subscriptions');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      correlationID: 's1',
      value: 5990,
      type: 'PIX_RECURRING',
      frequency: 'MONTHLY',
      pixRecurringOptions: {
        journey: 'PAYMENT_ON_APPROVAL',
        retryPolicy: 'THREE_RETRIES_7_DAYS',
      },
      customer,
    });
    expect(body).not.toHaveProperty('interval');
    // Journey 3 charges on approval: the charge day must be today (São Paulo date).
    expect(body.dayGenerateCharge).toBe('2026-11-05T00:00:00.000Z');
    expect(body.comment.length).toBeLessThan(30);
    expect(typeof body.name).toBe('string');
  });

  it('cancels a subscription with PUT /subscriptions/{id}/cancel', async () => {
    const fetchFn = fetchReturning(200, {});
    const client = new WooviClient(config, fetchFn as never);
    await client.cancelSubscription('abc 1');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.woovi.test/api/v1/subscriptions/abc%201/cancel',
    );
    expect(init.method).toBe('PUT');
  });

  it('turns a Woovi 4xx into a 502 with a clear message, never leaking the app id', async () => {
    const fetchFn = fetchReturning(400, {
      error: 'customer.address is required, key APP_ID_FIXTURE',
    });
    const client = new WooviClient(config, fetchFn as never);
    const failure = client.createCharge({
      correlationID: 'c',
      valueCents: 100,
      comment: 'x',
      expiresInSeconds: 60,
    });
    await expect(failure).rejects.toBeInstanceOf(BadGatewayException);
    await expect(failure).rejects.toThrow('Woovi request failed (400)');
    await expect(failure).rejects.not.toThrow(/APP_ID_FIXTURE/);
  });

  it('fails with a sanitized error and never leaks the app id', async () => {
    const fetchFn = fetchReturning(401, { error: 'bad key APP_ID_FIXTURE' });
    const client = new WooviClient(config, fetchFn as never);
    const failure = client.createCharge({
      correlationID: 'c1',
      valueCents: 100,
      comment: 'x',
      expiresInSeconds: 60,
    });
    await expect(failure).rejects.toThrow('Woovi request failed (401)');
    await expect(failure).rejects.not.toThrow(/APP_ID_FIXTURE/);
  });

  it('refuses to call Woovi when it is not configured', async () => {
    const client = new WooviClient(
      { ...config, appId: '' },
      jest.fn() as never,
    );
    await expect(
      client.createCharge({
        correlationID: 'c',
        valueCents: 1,
        comment: 'x',
        expiresInSeconds: 1,
      }),
    ).rejects.toThrow('Woovi is not configured');
  });
});
