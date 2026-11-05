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

  it('creates a monthly Pix Automático subscription', async () => {
    const fetchFn = fetchReturning(200, {
      subscription: {
        correlationID: 's1',
        status: 'WAITING_AUTHORIZATION',
        paymentLinkUrl: 'https://woovi.test/auth/s1',
      },
    });
    const client = new WooviClient(config, fetchFn as never);
    const sub = await client.createSubscription({
      correlationID: 's1',
      valueCents: 5990,
      comment: 'Corvo Solo',
      customer: { name: 'Ana', taxID: '12345678909', email: 'a@x.com' },
    });
    expect(sub.paymentLinkUrl).toBe('https://woovi.test/auth/s1');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.woovi.test/api/v1/subscriptions');
    expect(JSON.parse(init.body as string)).toMatchObject({
      correlationID: 's1',
      value: 5990,
      interval: 'MONTHLY',
      customer: { name: 'Ana', taxID: '12345678909', email: 'a@x.com' },
    });
  });

  it('cancels a subscription by correlationID', async () => {
    const fetchFn = fetchReturning(200, {});
    const client = new WooviClient(config, fetchFn as never);
    await client.cancelSubscription('s 1');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.woovi.test/api/v1/subscriptions/s%201');
    expect(init.method).toBe('DELETE');
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
