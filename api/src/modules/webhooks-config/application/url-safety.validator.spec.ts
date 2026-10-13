import { lookup } from 'node:dns/promises';
import { isPrivateIp, assertNotPrivateHost } from './url-safety.validator';
import { WebhookValidationError } from '../domain/errors';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

describe('isPrivateIp', () => {
  it.each([
    ['10.0.0.1', true],
    ['172.16.5.4', true],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.169.254', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['172.15.255.255', false],
    ['172.32.0.0', false],
  ])('classifies IPv4 %s as private=%s', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });

  it.each([
    ['::1', true],
    ['::', true],
    ['fc00::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:192.168.1.1', true],
    ['2001:db8::1', false],
  ])('classifies IPv6 %s as private=%s', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });

  it('returns false for non-IP strings', () => {
    expect(isPrivateIp('not-an-ip')).toBe(false);
  });
});

describe('assertNotPrivateHost', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('rejects "localhost" hostname', async () => {
    await expect(
      assertNotPrivateHost(new URL('http://localhost/')),
    ).rejects.toThrow(WebhookValidationError);
  });

  it('rejects "localhost" case-insensitively', async () => {
    await expect(
      assertNotPrivateHost(new URL('http://LOCALHOST/x')),
    ).rejects.toThrow(WebhookValidationError);
  });

  it('rejects 192.168.x.x IP literal', async () => {
    await expect(
      assertNotPrivateHost(new URL('http://192.168.1.1/admin')),
    ).rejects.toThrow(/private network/);
  });

  it('rejects 10.x.x.x IP literal', async () => {
    await expect(
      assertNotPrivateHost(new URL('http://10.0.0.1/')),
    ).rejects.toThrow(WebhookValidationError);
  });

  it('rejects 172.16.x.x IP literal', async () => {
    await expect(
      assertNotPrivateHost(new URL('http://172.16.0.1/')),
    ).rejects.toThrow(WebhookValidationError);
  });

  it('rejects cloud metadata IP 169.254.169.254', async () => {
    await expect(
      assertNotPrivateHost(new URL('http://169.254.169.254/latest/meta-data/')),
    ).rejects.toThrow(WebhookValidationError);
  });

  it('rejects 127.0.0.1 loopback', async () => {
    await expect(
      assertNotPrivateHost(new URL('http://127.0.0.1/')),
    ).rejects.toThrow(WebhookValidationError);
  });

  it('accepts public IP literal', async () => {
    await expect(
      assertNotPrivateHost(new URL('https://8.8.8.8/webhook')),
    ).resolves.toBeUndefined();
  });

  it('accepts hostname that resolves to public IPs', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);

    await expect(
      assertNotPrivateHost(new URL('https://example.com/webhook')),
    ).resolves.toBeUndefined();
    expect(mockLookup).toHaveBeenCalledWith('example.com', { all: true });
  });

  it('rejects hostname that resolves to private IPs', async () => {
    mockLookup.mockResolvedValue([
      { address: '192.168.1.50', family: 4 },
    ] as never);

    await expect(
      assertNotPrivateHost(new URL('https://malicious.example.com/')),
    ).rejects.toThrow(/resolves to a private address/);
  });

  it('rejects if any of multiple resolved IPs is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as never);

    await expect(
      assertNotPrivateHost(new URL('https://mixed.example.com/')),
    ).rejects.toThrow(/resolves to a private address/);
  });

  it('rejects when DNS resolution fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(
      assertNotPrivateHost(new URL('https://nonexistent.example.com/')),
    ).rejects.toThrow(/Cannot resolve/);
  });
});
