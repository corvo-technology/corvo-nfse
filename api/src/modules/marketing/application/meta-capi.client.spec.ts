import type { ConfigService } from '@nestjs/config';
import { MetaCapiClient, MetaCapiUnrecoverableError } from './meta-capi.client';

function mockFetch(): jest.MockedFunction<typeof fetch> {
  return jest.fn();
}

function configWith(overrides: Record<string, unknown> = {}) {
  return {
    getOrThrow: jest.fn().mockReturnValue({
      pixelId: 'pixel-123',
      capiToken: 'super-secret-token',
      capiEnabled: true,
      capiTestEventCode: undefined,
      ...overrides,
    }),
  } as unknown as ConfigService;
}

const baseEvent = {
  event_name: 'CompleteRegistration',
  event_time: 1700000000,
  event_id: 'evt-1',
  action_source: 'website' as const,
  user_data: { em: ['hash'] },
};

describe('MetaCapiClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('is a no-op when disabled or missing pixel id/token', async () => {
    const fetchMock = mockFetch();
    global.fetch = fetchMock;
    const client = new MetaCapiClient(configWith({ capiEnabled: false }));
    await client.send(baseEvent);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the access token in the body, never in the URL', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    global.fetch = fetchMock;
    const client = new MetaCapiClient(configWith());
    await client.send(baseEvent);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url as string).not.toContain('super-secret-token');
    expect(url as string).toContain('/pixel-123/events');
    const body = JSON.parse((init as RequestInit).body as string) as {
      access_token: string;
      data: unknown[];
    };
    expect(body.access_token).toBe('super-secret-token');
    expect(body.data).toEqual([baseEvent]);
  });

  it('includes the test_event_code only when configured', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    global.fetch = fetchMock;
    const client = new MetaCapiClient(
      configWith({ capiTestEventCode: 'TEST12345' }),
    );
    await client.send(baseEvent);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { test_event_code: string };
    expect(body.test_event_code).toBe('TEST12345');
  });

  it('throws a retryable error on a network failure (e.g. timeout)', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    );
    global.fetch = fetchMock;
    const client = new MetaCapiClient(configWith());
    await expect(client.send(baseEvent)).rejects.toThrow();
    await expect(client.send(baseEvent)).rejects.not.toBeInstanceOf(
      MetaCapiUnrecoverableError,
    );
  });

  it('throws a retryable error on 5xx and 429', async () => {
    for (const status of [500, 503, 429]) {
      const fetchMock = mockFetch();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: { fbtrace_id: 'trace-1' } }), {
          status,
        }),
      );
      global.fetch = fetchMock;
      const client = new MetaCapiClient(configWith());
      await expect(client.send(baseEvent)).rejects.not.toBeInstanceOf(
        MetaCapiUnrecoverableError,
      );
    }
  });

  it('throws MetaCapiUnrecoverableError on 4xx other than 429', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { fbtrace_id: 'trace-2' } }), {
        status: 400,
      }),
    );
    global.fetch = fetchMock;
    const client = new MetaCapiClient(configWith());
    await expect(client.send(baseEvent)).rejects.toBeInstanceOf(
      MetaCapiUnrecoverableError,
    );
  });

  it('never leaks the access token in a thrown error message', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { fbtrace_id: 'trace-3' } }), {
        status: 400,
      }),
    );
    global.fetch = fetchMock;
    const client = new MetaCapiClient(configWith());
    try {
      await client.send(baseEvent);
      fail('expected send to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-token');
      expect((error as Error).message).toContain('trace-3');
    }
  });
});
