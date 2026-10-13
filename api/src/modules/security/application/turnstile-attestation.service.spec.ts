/* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-argument */
import { TurnstileAttestationService } from './turnstile-attestation.service';

function makeRedis() {
  return {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    getdel: jest.fn().mockResolvedValue(null),
  };
}

describe('TurnstileAttestationService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let service: TurnstileAttestationService;

  beforeEach(() => {
    redis = makeRedis();
    service = new TurnstileAttestationService(redis as any);
  });

  describe('hashToken', () => {
    it('returns a consistent SHA-256 hex digest', () => {
      const hash = TurnstileAttestationService.hashToken('test-token');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(TurnstileAttestationService.hashToken('test-token')).toBe(hash);
    });

    it('produces different hashes for different inputs', () => {
      const a = TurnstileAttestationService.hashToken('token-a');
      const b = TurnstileAttestationService.hashToken('token-b');
      expect(a).not.toBe(b);
    });
  });

  describe('create', () => {
    it('returns a base64url token string', async () => {
      const token = await service.create({
        action: 'login',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
      });

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
      // base64url characters only
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('stores the attestation in Redis with 30-minute TTL', async () => {
      const token = await service.create({
        action: 'signup',
        hostname: 'app.greenflow.test',
        productKey: 'divella',
        tenantId: 'tenant-123',
        slug: 'my-shop',
      });

      const tokenHash = TurnstileAttestationService.hashToken(token);
      expect(redis.set).toHaveBeenCalledWith(
        `gf:attest:${tokenHash}`,
        expect.any(String),
        'EX',
        1800,
      );

      const stored = JSON.parse(redis.set.mock.calls[0][1]);
      expect(stored).toEqual({
        tokenHash,
        action: 'signup',
        hostname: 'app.greenflow.test',
        productKey: 'divella',
        tenantId: 'tenant-123',
        slug: 'my-shop',
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
        ipPrefixHash: null,
        userAgentHash: null,
      });
    });

    it('defaults tenantId and slug to null when not provided', async () => {
      const _token = await service.create({
        action: 'booking',
        hostname: 'booking.greenflow.test',
        productKey: 'greenbarber',
      });

      const stored = JSON.parse(redis.set.mock.calls[0][1]);
      expect(stored.tenantId).toBeNull();
      expect(stored.slug).toBeNull();
    });
  });

  describe('consume', () => {
    it('returns the attestation and removes it from Redis (GETDEL)', async () => {
      const token = await service.create({
        action: 'login',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
      });

      const tokenHash = TurnstileAttestationService.hashToken(token);
      const attestation = {
        tokenHash,
        action: 'login',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
        tenantId: null,
        slug: null,
        createdAt: '2026-08-04T00:00:00.000Z',
      };
      redis.getdel.mockResolvedValue(JSON.stringify(attestation));

      const result = await service.consume(token);

      expect(redis.getdel).toHaveBeenCalledWith(`gf:attest:${tokenHash}`);
      expect(result).toEqual(attestation);
    });

    it('returns null when the attestation does not exist', async () => {
      redis.getdel.mockResolvedValue(null);

      const result = await service.consume('non-existent-token');
      expect(result).toBeNull();
    });

    it('is idempotent: second consume returns null', async () => {
      const token = await service.create({
        action: 'login',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
      });

      const tokenHash = TurnstileAttestationService.hashToken(token);
      const attestation = {
        tokenHash,
        action: 'login',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
        tenantId: null,
        slug: null,
        createdAt: '2026-08-04T00:00:00.000Z',
      };
      redis.getdel.mockResolvedValueOnce(JSON.stringify(attestation));
      redis.getdel.mockResolvedValueOnce(null);

      const first = await service.consume(token);
      const second = await service.consume(token);

      expect(first).toEqual(attestation);
      expect(second).toBeNull();
      expect(redis.getdel).toHaveBeenCalledTimes(2);
    });
  });

  describe('peek', () => {
    it('returns attestation without removing it from Redis', async () => {
      const token = await service.create({
        action: 'waitlist',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
      });

      const tokenHash = TurnstileAttestationService.hashToken(token);
      const attestation = {
        tokenHash,
        action: 'waitlist',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
        tenantId: null,
        slug: null,
        createdAt: '2026-08-04T00:00:00.000Z',
      };
      redis.get.mockResolvedValue(JSON.stringify(attestation));

      const result = await service.peek(token);

      expect(redis.get).toHaveBeenCalledWith(`gf:attest:${tokenHash}`);
      expect(result).toEqual(attestation);
      // peek uses GET, not GETDEL
      expect(redis.getdel).not.toHaveBeenCalled();
    });

    it('returns null for a non-existent token', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.peek('non-existent-token');
      expect(result).toBeNull();
    });

    it('does not remove the attestation so it can be consumed later', async () => {
      const token = await service.create({
        action: 'login',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
      });

      const tokenHash = TurnstileAttestationService.hashToken(token);
      const attestation = {
        tokenHash,
        action: 'login',
        hostname: 'app.greenflow.test',
        productKey: 'greenbarber',
        tenantId: null,
        slug: null,
        createdAt: '2026-08-04T00:00:00.000Z',
      };
      redis.get.mockResolvedValue(JSON.stringify(attestation));
      redis.getdel.mockResolvedValue(JSON.stringify(attestation));

      await service.peek(token);
      const consumed = await service.consume(token);

      expect(consumed).toEqual(attestation);
      expect(redis.get).toHaveBeenCalledTimes(1);
      expect(redis.getdel).toHaveBeenCalledTimes(1);
    });
  });
});
