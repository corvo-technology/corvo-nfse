import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { resolveClientIp } from '@/shared/http/client-ip';
import { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';

/** Per-IP ceiling for the public inbound endpoint; the connector's signature is the real protection. */
@Injectable()
export class InboundRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RedisRateLimiter,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const max =
      this.config.get<number>('RATE_LIMIT_INTEGRATION_INBOUND') ?? 600;
    const result = await this.limiter.check(
      `integration-inbound:ip:${resolveClientIp(request) ?? 'unknown'}`,
      { max, windowMs: 60000 },
    );
    if (!result.allowed) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
      );
      throw new HttpException(
        { code: 'ERROR_RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' },
        429,
      );
    }
    return true;
  }
}
