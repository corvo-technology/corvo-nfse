import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { WooviClient } from './woovi.client';

const config = {
  enabled: true,
  appId: 'APP_ID_FIXTURE',
  webhookToken: 'token-token-token-token',
  apiUrl: 'https://api.woovi.test/api/v1',
};

/** Answers each call with the next response, in order. */
function fetchSequence(...responses: Array<[number, unknown]>) {
  const queue = [...responses];
  return jest.fn(async () => {
    const [status, body] = queue.shift() ?? [200, {}];
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

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

  const payer = {
    name: 'Ana Souza',
    taxID: '12345678909',
    email: 'a@x.com',
    phone: '5511999999999',
  };
  const subscriptionInput = {
    correlationID: 's1',
    customerCorrelationID: 'tenant-1',
    valueCents: 5990,
    planName: 'Corvo Solo',
    comment: 'Corvo Solo (mensal)',
    customer: payer,
  };

  it('registers the payer first, then creates the Pix Automático contract (journey 3) the way that works in production', async () => {
    const fetchFn = fetchSequence(
      [200, { customer: { taxID: { taxID: payer.taxID } } }],
      [
        200,
        {
          subscription: {
            correlationID: 's1',
            globalID: 'UGF5bWVudA==',
            paymentLinkUrl: 'https://woovi.test/pay/s1',
            pixRecurring: { emv: '000201EMV' },
          },
        },
      ],
    );
    const client = new WooviClient(
      config,
      fetchFn as never,
      () => new Date('2026-11-05T15:00:00Z'),
    );
    const sub = await client.createSubscription(subscriptionInput);
    expect(sub).toEqual({
      correlationID: 's1',
      providerId: 'UGF5bWVudA==',
      paymentLinkUrl: 'https://woovi.test/pay/s1',
      brCode: '000201EMV',
    });
    const calls = fetchFn.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe('https://api.woovi.test/api/v1/customer');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      ...payer,
      correlationID: 'tenant-1',
    });
    expect(calls[1][0]).toBe('https://api.woovi.test/api/v1/subscriptions');
    const body = JSON.parse(calls[1][1].body as string);
    expect(body).toEqual({
      name: 'Corvo Solo',
      correlationID: 's1',
      value: 5990,
      comment: 'Corvo Solo (mensal)',
      frequency: 'MONTHLY',
      type: 'PIX_RECURRING',
      pixRecurringOptions: {
        journey: 'PAYMENT_ON_APPROVAL',
        retryPolicy: 'THREE_RETRIES_7_DAYS',
      },
      dayGenerateCharge: 5,
      dayDue: 3,
      customer: payer,
    });
    expect(body).not.toHaveProperty('interval');
  });

  it('keeps the charge day within 1-27 (the cycle day Woovi accepts)', async () => {
    const fetchFn = fetchSequence(
      [200, {}],
      [200, { subscription: { correlationID: 's1', paymentLinkUrl: 'u' } }],
    );
    const client = new WooviClient(
      config,
      fetchFn as never,
      () => new Date('2026-12-31T15:00:00Z'),
    );
    await client.createSubscription(subscriptionInput);
    const body = JSON.parse(
      (fetchFn.mock.calls as unknown as Array<[string, RequestInit]>)[1][1]
        .body as string,
    );
    expect(body.dayGenerateCharge).toBe(27);
  });

  it.each([
    [409, { error: 'conflict' }],
    [400, { error: 'Há outro cliente com esses dados' }],
  ])(
    'goes on when the payer already exists in Woovi (%s)',
    async (status, body) => {
      const fetchFn = fetchSequence(
        [status, body],
        [200, { subscription: { correlationID: 's1', paymentLinkUrl: 'u' } }],
      );
      const client = new WooviClient(config, fetchFn as never);
      await expect(
        client.createSubscription(subscriptionInput),
      ).resolves.toMatchObject({ paymentLinkUrl: 'u' });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    },
  );

  it("stops with Woovi's reason when the payer is invalid, without creating the contract", async () => {
    const fetchFn = fetchSequence([400, { error: 'taxID inválido' }]);
    const client = new WooviClient(config, fetchFn as never);
    await expect(client.createSubscription(subscriptionInput)).rejects.toThrow(
      /taxID inválido/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
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

  it("turns a Woovi validation error (4xx) into a 400 that carries Woovi's reason, never the app id", async () => {
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
    await expect(failure).rejects.toBeInstanceOf(BadRequestException);
    await expect(failure).rejects.toThrow(/customer\.address is required/);
    await expect(failure).rejects.not.toThrow(/APP_ID_FIXTURE/);
  });

  it("reads Woovi's errors array too", async () => {
    const fetchFn = fetchReturning(400, {
      errors: [{ message: 'taxID inválido' }, { message: 'phone inválido' }],
    });
    const client = new WooviClient(config, fetchFn as never);
    await expect(
      client.createCharge({
        correlationID: 'c',
        valueCents: 100,
        comment: 'x',
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow(/taxID inválido; phone inválido/);
  });

  it.each([500, 503])('turns a Woovi %s into a 502', async (status) => {
    const client = new WooviClient(
      config,
      fetchReturning(status, { error: 'down' }) as never,
    );
    await expect(
      client.createCharge({
        correlationID: 'c',
        valueCents: 100,
        comment: 'x',
        expiresInSeconds: 60,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
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
