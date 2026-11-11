import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig, AuthConfig } from '@/infra/config/configuration.types';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { PackageScope } from '../../domain/invoice-package.repository';

export const PACKAGE_LINK_TTL_SECONDS = 7 * 24 * 3600;

export type { PackageScope };

interface Payload {
  t: string;
  c: string;
  e: ExecutionEnvironment;
  m: string;
  x: number;
}

const invalid = () =>
  new NotFoundException({
    code: 'PACKAGE_LINK_INVALID',
    message: 'Package link not found',
  });

/**
 * Temporary download links for one month package of one company. The link is a signed
 * token (nothing is stored): it opens that package only, without login, until it expires.
 */
@Injectable()
export class PackageLinkService {
  constructor(private readonly config: ConfigService) {}

  private sign(body: string): string {
    const secret = this.config.getOrThrow<AuthConfig>('auth').csrfSigningSecret;
    return createHmac('sha256', secret)
      .update(`invoice-package-link:${body}`)
      .digest('base64url');
  }

  create(
    scope: PackageScope,
    now = new Date(),
  ): { token: string; expiresAt: Date } {
    const expiresAt = new Date(now.getTime() + PACKAGE_LINK_TTL_SECONDS * 1000);
    const payload: Payload = {
      t: scope.tenantId,
      c: scope.companyId,
      e: scope.environment,
      m: scope.month,
      x: Math.floor(expiresAt.getTime() / 1000),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { token: `${body}.${this.sign(body)}`, expiresAt };
  }

  verify(token: string, now = new Date()): PackageScope {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) throw invalid();
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw invalid();
    let payload: Payload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as Payload;
    } catch {
      throw invalid();
    }
    if (
      typeof payload.t !== 'string' ||
      typeof payload.c !== 'string' ||
      typeof payload.m !== 'string' ||
      typeof payload.x !== 'number' ||
      (payload.e !== 'test' && payload.e !== 'live')
    )
      throw invalid();
    if (payload.x * 1000 <= now.getTime())
      throw new GoneException({
        code: 'PACKAGE_LINK_EXPIRED',
        message: 'Package link expired',
      });
    return {
      tenantId: payload.t,
      companyId: payload.c,
      environment: payload.e,
      month: payload.m,
    };
  }

  /** Public URL anyone holding the link can open. Needs PUBLIC_API_URL. */
  url(token: string): string {
    const origin = this.config.get<string>('PUBLIC_API_URL');
    if (!origin)
      throw new Error('PUBLIC_API_URL is required to build package links');
    const prefix = this.config.getOrThrow<AppConfig>('app').apiPrefix;
    return `${new URL(origin).origin}/${prefix}/invoice-package-links/${token}`;
  }
}
