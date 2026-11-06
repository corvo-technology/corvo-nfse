import { resolveClientIp } from './client-ip';

const SECRET = 'a'.repeat(32);

describe('resolveClientIp', () => {
  it('uses req.ip when the remote address is not a trusted proxy', () => {
    expect(
      resolveClientIp(
        {
          ip: '203.0.113.8',
          headers: {
            'cf-connecting-ip': '198.51.100.10',
            'x-forwarded-for': '198.51.100.11',
          },
        },
        { TRUST_CF_CONNECTING_IP: 'true' },
      ),
    ).toBe('203.0.113.8');
  });

  it('ignores a forged cf-connecting-ip unless Cloudflare is declared', () => {
    expect(
      resolveClientIp(
        {
          ip: '10.0.0.1',
          headers: {
            'cf-connecting-ip': '198.51.100.10',
            'x-forwarded-for': '203.0.113.50',
          },
        },
        {},
      ),
    ).toBe('203.0.113.50');
  });

  it('accepts cf-connecting-ip when the operator declares Cloudflare', () => {
    expect(
      resolveClientIp(
        { ip: '10.0.0.1', headers: { 'cf-connecting-ip': '198.51.100.10' } },
        { TRUST_CF_CONNECTING_IP: 'true' },
      ),
    ).toBe('198.51.100.10');
  });

  it('uses the last x-forwarded-for entry (the one our proxy appended)', () => {
    expect(
      resolveClientIp(
        {
          ip: '192.168.1.10',
          headers: {
            'x-forwarded-for': '198.51.100.99, bad-value, 198.51.100.21',
          },
        },
        {},
      ),
    ).toBe('198.51.100.21');
  });

  it('falls back to the peer when there are no usable headers', () => {
    expect(resolveClientIp({ ip: '10.0.0.5', headers: {} }, {})).toBe(
      '10.0.0.5',
    );
  });

  it('ignores invalid forwarded headers from untrusted peers', () => {
    expect(
      resolveClientIp(
        {
          ip: '203.0.113.8',
          headers: {
            'cf-connecting-ip': 'not-an-ip',
            'x-forwarded-for': '198.51.100.30',
          },
        },
        {},
      ),
    ).toBe('203.0.113.8');
  });

  it('uses the browser IP sent by the web proxy when the secret matches', () => {
    expect(
      resolveClientIp(
        {
          ip: '172.18.0.4',
          headers: {
            'x-corvo-client-ip': '198.51.100.44',
            'x-corvo-proxy-secret': SECRET,
          },
        },
        { PROXY_SHARED_SECRET: SECRET },
      ),
    ).toBe('198.51.100.44');
  });

  it('ignores x-corvo-client-ip with a wrong or missing secret', () => {
    const headers = {
      'x-corvo-client-ip': '198.51.100.44',
      'x-corvo-proxy-secret': 'wrong',
      'x-forwarded-for': '203.0.113.9',
    };
    expect(
      resolveClientIp(
        { ip: '172.18.0.4', headers },
        { PROXY_SHARED_SECRET: SECRET },
      ),
    ).toBe('203.0.113.9');
    expect(resolveClientIp({ ip: '172.18.0.4', headers }, {})).toBe(
      '203.0.113.9',
    );
  });
});
