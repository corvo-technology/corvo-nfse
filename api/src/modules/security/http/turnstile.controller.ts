import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrorResponses } from '@/infra/openapi/swagger';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { resolveClientIp } from '@/shared/http/client-ip';
import { data } from '@/shared/http/response';
import { TurnstileVerificationService } from '../application/turnstile-verification.service';
import { VerifyTurnstileDto } from './turnstile.dto';

type HttpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
};

@Controller('public/security/turnstile')
@ApiTags('Security')
@ApiErrorResponses()
export class TurnstileController {
  constructor(private readonly turnstile: TurnstileVerificationService) {}

  @PublicRoute()
  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(@Req() req: HttpRequest, @Body() body: VerifyTurnstileDto) {
    const token = resolveToken(body);
    if (!token) {
      throw new BadRequestException('Turnstile token is required');
    }

    return data(
      await this.turnstile.verify({
        token,
        remoteIp: resolveClientIp(req),
      }),
    );
  }
}

function resolveToken(body: VerifyTurnstileDto): string | undefined {
  return firstNonBlank(body.token, body.response, body.cfTurnstileResponse);
}

function firstNonBlank(
  ...values: Array<string | null | undefined>
): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}
