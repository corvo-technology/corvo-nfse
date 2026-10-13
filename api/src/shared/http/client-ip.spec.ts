import { resolveClientIp } from './client-ip';

describe('resolveClientIp', () => {
  it('uses req.ip when the remote address is not a trusted proxy', () => {
    expect(
      resolveClientIp({
        ip: '203.0.113.8',
        headers: {
          'cf-connecting-ip': '198.51.100.10',
          'x-forwarded-for': '198.51.100.11',
        },
      }),
    ).toBe('203.0.113.8');
  });

  it('accepts cf-connecting-ip when the remote address is trusted', () => {
    expect(
      resolveClientIp({
        ip: '10.0.0.1',
        headers: { 'cf-connecting-ip': '198.51.100.10' },
      }),
    ).toBe('198.51.100.10');
  });

  it('accepts the first valid x-forwarded-for address when allowed', () => {
    expect(
      resolveClientIp({
        ip: '192.168.1.10',
        headers: {
          'x-forwarded-for': 'bad-value, 198.51.100.20, 198.51.100.21',
        },
      }),
    ).toBe('198.51.100.20');
  });

  it('ignores invalid or spoofed forwarded headers', () => {
    expect(
      resolveClientIp({
        ip: '203.0.113.8',
        headers: {
          'cf-connecting-ip': 'not-an-ip',
          'x-forwarded-for': '198.51.100.30',
        },
      }),
    ).toBe('203.0.113.8');
  });

  it('uses the original booking client IP when the proxy secret matches', () => {
    expect(
      resolveClientIp(
        {
          ip: '10.0.0.1',
          headers: {
            'cf-connecting-ip': '2a02:4780:14:186e::1',
            'x-greenflow-client-ip': '198.51.100.44',
            'x-greenflow-booking-proxy-secret': 'a'.repeat(32),
          },
        },
        { bookingProxySecret: 'a'.repeat(32) },
      ),
    ).toBe('198.51.100.44');
  });

  it('ignores a forged booking client IP without the correct secret', () => {
    expect(
      resolveClientIp(
        {
          ip: '10.0.0.1',
          headers: {
            'cf-connecting-ip': '2a02:4780:14:186e::1',
            'x-greenflow-client-ip': '198.51.100.44',
            'x-greenflow-booking-proxy-secret': 'wrong-secret',
          },
        },
        { bookingProxySecret: 'a'.repeat(32) },
      ),
    ).toBe('2a02:4780:14:186e::1');
  });
});
