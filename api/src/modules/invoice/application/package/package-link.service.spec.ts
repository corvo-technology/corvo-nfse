import { ConfigService } from '@nestjs/config';
import {
  PACKAGE_LINK_TTL_SECONDS,
  PackageLinkService,
} from './package-link.service';

const config = (secret = 'a'.repeat(32)) =>
  new ConfigService({
    auth: { csrfSigningSecret: secret },
    app: { apiPrefix: 'v1' },
    PUBLIC_API_URL: 'https://api.corvo.example',
  });

const scope = {
  tenantId: 'tenant-a',
  companyId: 'company-a',
  environment: 'live' as const,
  month: '2026-10',
};

describe('PackageLinkService', () => {
  const now = new Date('2026-11-01T11:00:00Z');

  it('opens the package the link was made for, for 7 days', () => {
    const service = new PackageLinkService(config());
    const { token, expiresAt } = service.create(scope, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(
      PACKAGE_LINK_TTL_SECONDS * 1000,
    );
    expect(service.verify(token, now)).toEqual(scope);
    const lastSecond = new Date(expiresAt.getTime() - 1000);
    expect(service.verify(token, lastSecond)).toEqual(scope);
  });

  it('expires after 7 days', () => {
    const service = new PackageLinkService(config());
    const { token, expiresAt } = service.create(scope, now);
    expect(() => service.verify(token, expiresAt)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'PACKAGE_LINK_EXPIRED' }),
      }),
    );
  });

  it('rejects a token with another tenant, company or month swapped in', () => {
    const service = new PackageLinkService(config());
    const { token } = service.create(scope, now);
    const [, signature] = token.split('.');
    for (const change of [
      { t: 'tenant-b' },
      { c: 'company-b' },
      { m: '2026-09' },
      { e: 'test' },
    ]) {
      const payload = {
        ...JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()),
        ...change,
      };
      const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
      expect(() => service.verify(forged, now)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PACKAGE_LINK_INVALID' }),
        }),
      );
    }
  });

  it('rejects garbage and tokens signed with another secret', () => {
    const service = new PackageLinkService(config());
    const other = new PackageLinkService(config('b'.repeat(32)));
    for (const token of ['', 'abc', 'a.b.c', other.create(scope, now).token])
      expect(() => service.verify(token, now)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PACKAGE_LINK_INVALID' }),
        }),
      );
  });

  it('builds the public URL under the API prefix', () => {
    expect(new PackageLinkService(config()).url('tok')).toBe(
      'https://api.corvo.example/v1/invoice-package-links/tok',
    );
  });
});
