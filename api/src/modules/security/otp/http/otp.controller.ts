import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiErrorResponses } from '@/infra/openapi/swagger';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { resolveClientIp } from '@/shared/http/client-ip';
import { data } from '@/shared/http/response';
import { OtpFlowService } from '../application/otp-flow.service';
import {
  InvalidOtpTargetError,
  OtpDeliveryUnavailableError,
  OtpIssueCooldownError,
  OtpIssueRateLimitError,
  OtpVerificationFailedError,
} from '../domain/otp-errors';
import { PUBLIC_OTP_PURPOSES } from '../domain/otp.types';
import { RequestOtpDto, VerifyOtpDto } from './otp.dto';

type OtpHttpRequest = RequestWithAuthContext & {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
};

@Controller('public/security/otp')
@ApiTags('Security')
@ApiErrorResponses()
export class PublicOtpController {
  constructor(private readonly otp: OtpFlowService) {}

  @PublicRoute()
  @Post('challenges')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async request(
    @Req() req: OtpHttpRequest,
    @Body() body: RequestOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!PUBLIC_OTP_PURPOSES.includes(body.purpose)) {
      throw otpHttpError(
        400,
        'OTP_PURPOSE_NOT_ALLOWED',
        'OTP purpose is not public',
      );
    }
    const productKey = 'corvo';
    try {
      return data(
        presentIssue(
          await this.otp.request({
            ...body,
            audience: 'public',
            productKey,
            subjectId: this.otp.publicSubjectId(
              productKey,
              body.channel,
              body.target,
            ),
            tenantId: req.authContext?.tenantId,
            requestIp: resolveClientIp(req),
          }),
        ),
      );
    } catch (error) {
      throw mapOtpError(error, response);
    }
  }

  @PublicRoute()
  @Post('challenges/:challengeId/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async verify(
    @Req() req: OtpHttpRequest,
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @Body() body: VerifyOtpDto,
  ) {
    if (!PUBLIC_OTP_PURPOSES.includes(body.purpose)) {
      throw otpHttpError(
        400,
        'OTP_PURPOSE_NOT_ALLOWED',
        'OTP purpose is not public',
      );
    }
    const productKey = 'corvo';
    try {
      return data(
        presentProof(
          await this.otp.verify({
            ...body,
            challengeId,
            audience: 'public',
            productKey,
            subjectId: this.otp.publicSubjectId(
              productKey,
              body.channel,
              body.target,
            ),
          }),
        ),
      );
    } catch (error) {
      throw mapOtpError(error);
    }
  }
}

@Controller('security/otp')
@ApiTags('Security')
@ApiErrorResponses()
export class AuthenticatedOtpController {
  constructor(private readonly otp: OtpFlowService) {}

  @Post('challenges')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async request(
    @Req() req: OtpHttpRequest,
    @Body() body: RequestOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return data(
        presentIssue(
          await this.otp.request({
            ...body,
            audience: 'authenticated',
            productKey: 'corvo',
            subjectId: requireAuthUserId(req),
            tenantId: req.authContext?.tenantId,
            requestIp: resolveClientIp(req),
          }),
        ),
      );
    } catch (error) {
      throw mapOtpError(error, response);
    }
  }

  @Post('challenges/:challengeId/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async verify(
    @Req() req: OtpHttpRequest,
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @Body() body: VerifyOtpDto,
  ) {
    try {
      return data(
        presentProof(
          await this.otp.verify({
            ...body,
            challengeId,
            audience: 'authenticated',
            productKey: 'corvo',
            subjectId: requireAuthUserId(req),
          }),
        ),
      );
    } catch (error) {
      throw mapOtpError(error);
    }
  }
}

function requireAuthUserId(req: OtpHttpRequest): string {
  const id = req.authContext?.authUserId;
  if (!id)
    throw otpHttpError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
    );
  return id;
}

function presentIssue(result: Awaited<ReturnType<OtpFlowService['request']>>) {
  return {
    ...result,
    expiresAt: new Date(result.expiresAt).toISOString(),
    resendAvailableAt: new Date(result.resendAvailableAt).toISOString(),
  };
}

function presentProof(result: Awaited<ReturnType<OtpFlowService['verify']>>) {
  return {
    verificationToken: result.verificationToken,
    expiresAt: new Date(result.expiresAt).toISOString(),
  };
}

function mapOtpError(error: unknown, response?: Response): HttpException {
  if (error instanceof OtpIssueCooldownError) {
    response?.setHeader('Retry-After', error.retryAfterSeconds);
    return otpHttpError(
      error.statusCode,
      error.code,
      'OTP resend cooldown is active',
    );
  }
  if (error instanceof OtpIssueRateLimitError) {
    response?.setHeader('Retry-After', error.retryAfterSeconds);
    return otpHttpError(
      error.statusCode,
      error.code,
      'OTP issue rate limit exceeded',
    );
  }
  if (error instanceof OtpDeliveryUnavailableError) {
    return otpHttpError(
      error.statusCode,
      error.code,
      'OTP delivery is unavailable',
    );
  }
  if (error instanceof InvalidOtpTargetError) {
    return otpHttpError(error.statusCode, error.code, 'OTP target is invalid');
  }
  if (error instanceof OtpVerificationFailedError) {
    return otpHttpError(
      error.statusCode,
      'OTP_INVALID_OR_EXPIRED',
      error.message,
    );
  }
  if (error instanceof HttpException) return error;
  throw error;
}

function otpHttpError(statusCode: number, code: string, message: string) {
  return new HttpException({ statusCode, code, message }, statusCode);
}
