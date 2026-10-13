import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { MagicLinkService } from '../application/magic-link.service';
import { data } from '@/shared/http/response';
import { PublicRoute } from '../application/public-route.decorator';
import { CookiePolicyService } from '../application/cookie-policy.service';
import { resolveClientIp } from '@/shared/http/client-ip';
import {
  OtpDeliveryUnavailableError,
  OtpIssueCooldownError,
  OtpIssueRateLimitError,
} from '@/modules/security/otp/domain/otp-errors';

class RequestMagicLinkDto {
  @IsEmail()
  email!: string;
}

class VerifyMagicLinkDto {
  @IsUUID()
  challengeId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}

@Controller('auth/magic-link')
@PublicRoute()
@ApiTags('Auth')
export class MagicLinkController {
  constructor(
    private readonly magicLinkService: MagicLinkService,
    private readonly cookies: CookiePolicyService,
  ) {}

  @Post('request')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBody({ type: RequestMagicLinkDto })
  async request(
    @Body() body: RequestMagicLinkDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return data(
        await this.magicLinkService.requestCode(
          body.email,
          resolveClientIp(req),
        ),
      );
    } catch (error) {
      if (
        error instanceof OtpIssueCooldownError ||
        error instanceof OtpIssueRateLimitError
      ) {
        res.setHeader('Retry-After', error.retryAfterSeconds);
        throw new HttpException(
          {
            statusCode: error.statusCode,
            code: error.code,
            message: 'Try requesting a code again later',
          },
          error.statusCode,
        );
      }
      if (error instanceof OtpDeliveryUnavailableError) {
        throw new HttpException(
          {
            statusCode: error.statusCode,
            code: error.code,
            message: 'Email delivery is unavailable',
          },
          error.statusCode,
        );
      }
      throw error;
    }
  }

  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiBody({ type: VerifyMagicLinkDto })
  async verify(
    @Body() body: VerifyMagicLinkDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.magicLinkService.verifyCode(
      body.email,
      body.code,
      body.challengeId,
    );
    this.cookies.set(res, 'session', result.sessionToken, result.expiresAt);
    return data({
      expiresAt: result.expiresAt,
      isNewUser: result.isNewUser,
      csrfToken: result.csrfToken,
    });
  }
}
