import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppConfig, AuthConfig } from '@/infra/config/configuration.types';

@Injectable()
export class CsrfService {
  private readonly signingKey: string;
  private readonly allowedOrigins: Set<string>;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getOrThrow<AuthConfig>('auth');
    this.signingKey = config.csrfSigningSecret;
    this.allowedOrigins = new Set(
      this.configService
        .getOrThrow<AppConfig>('app')
        .corsOrigins.map((origin) => new URL(origin).origin),
    );
  }

  generateToken(sessionId: string): string {
    return createHmac('sha256', this.signingKey)
      .update(sessionId)
      .digest('base64url');
  }

  validateToken(sessionId: string, token: string): boolean {
    const expected = this.generateToken(sessionId);
    if (expected.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }

  validateBrowserMutation(
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const origin = first(headers.origin);
    if (!origin || !this.allowedOrigins.has(origin)) return false;
    const fetchSite = first(headers['sec-fetch-site']);
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
      return false;
    }
    const contentType = (first(headers['content-type']) ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    return (
      contentType === 'application/json' ||
      contentType === 'multipart/form-data'
    );
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
