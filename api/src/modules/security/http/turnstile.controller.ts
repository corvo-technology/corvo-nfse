import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrorResponses } from '@/infra/openapi/swagger';
import { CookiePolicyService } from '@/modules/auth/application/cookie-policy.service';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { resolveClientIp } from '@/shared/http/client-ip';
import { data } from '@/shared/http/response';
import { TurnstileAttestationService } from '../application/turnstile-attestation.service';
import { TurnstileVerificationService } from '../application/turnstile-verification.service';
import { recordHumanProofEvent } from '../observability/security.metrics';
import { VerifyTurnstileDto } from './turnstile.dto';

type HttpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
};

const PRODUCT_KEY = 'corvo';
const ATTESTATION_TTL_MS = 30 * 60 * 1000;

@Controller('public/security/turnstile')
@ApiTags('Security')
@ApiErrorResponses()
export class TurnstileController {
  constructor(
    private readonly turnstile: TurnstileVerificationService,
    private readonly attestations: TurnstileAttestationService,
    private readonly cookies: CookiePolicyService,
  ) {}

  @PublicRoute()
  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(
    @Req() req: HttpRequest,
    @Body() body: VerifyTurnstileDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const token = resolveToken(body);
    if (!token) {
      throw new BadRequestException('Turnstile token is required');
    }
    const remoteIp = resolveClientIp(req);
    const action = body.action;

    const verification = await this.turnstile.verify({
      token,
      remoteIp,
      expectedAction: action,
    });
    // Without an action this stays a plain token check, as before.
    if (!action) return data(verification);

    if (!verification.success) {
      recordHumanProofEvent('verification_failed', action, PRODUCT_KEY);
      return data({ isVerified: false, errorCodes: verification.errorCodes });
    }
    const ipPrefix = normalizeIpPrefix(remoteIp ?? '');
    if (
      !(await this.attestations.assertVerifyRate({
        ipPrefix,
        productKey: PRODUCT_KEY,
        action,
      }))
    ) {
      recordHumanProofEvent('rate_limited', action, PRODUCT_KEY);
      throw new HttpException(
        {
          code: 'SECURITY_RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
        },
        429,
      );
    }
    const proof = await this.attestations.create({
      action,
      hostname: verification.hostname ?? '',
      productKey: PRODUCT_KEY,
      ipPrefix,
      userAgent: firstHeader(req, 'user-agent'),
    });
    this.cookies.set(
      res as Response,
      `human_${action}`,
      proof,
      undefined,
      ATTESTATION_TTL_MS,
    );
    recordHumanProofEvent('proof_issued', action, PRODUCT_KEY);
    return data({
      isVerified: true,
      expiresAt: new Date(Date.now() + ATTESTATION_TTL_MS).toISOString(),
    });
  }
}

function normalizeIpPrefix(ip: string): string {
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':');
  return ip.split('.').slice(0, 3).join('.');
}

function firstHeader(req: HttpRequest, name: string): string | undefined {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function resolveToken(body: VerifyTurnstileDto): string | undefined {
  return firstNonBlank(body.token, body.response, body.cfTurnstileResponse);
}

function firstNonBlank(
  ...values: Array<string | null | undefined>
): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}
