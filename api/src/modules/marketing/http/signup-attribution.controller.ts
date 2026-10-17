import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { data } from '@/shared/http/response';
import type { AuthContext } from '@/modules/auth/auth-context';
import { SignupAttributionService } from '../application/signup-attribution.service';

class SignupAttributionUtmDto {
  @IsOptional() @IsString() @MaxLength(256) source?: string;
  @IsOptional() @IsString() @MaxLength(256) medium?: string;
  @IsOptional() @IsString() @MaxLength(256) campaign?: string;
  @IsOptional() @IsString() @MaxLength(256) term?: string;
  @IsOptional() @IsString() @MaxLength(256) content?: string;
}

class SignupAttributionDto {
  @IsUUID()
  eventId!: string;

  @IsBoolean()
  consent!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  consentVersion?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SignupAttributionUtmDto)
  utm?: SignupAttributionUtmDto;

  @IsOptional() @IsString() @MaxLength(512) fbclid?: string;
  @IsOptional() @IsString() @MaxLength(256) fbc?: string;
  @IsOptional() @IsString() @MaxLength(256) fbp?: string;
  @IsOptional() @IsString() @MaxLength(2048) landingUrl?: string;
  @IsOptional() @IsString() @MaxLength(2048) eventSourceUrl?: string;
}

type HttpRequest = Request & { authContext?: AuthContext };

@Controller('auth/signup-attribution')
@ApiTags('Auth')
export class SignupAttributionController {
  constructor(private readonly service: SignupAttributionService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: SignupAttributionDto })
  async record(@Body() body: SignupAttributionDto, @Req() req: HttpRequest) {
    const authContext = req.authContext;
    if (!authContext) {
      throw new UnauthorizedException('Authenticated context is required');
    }
    const result = await this.service.record(authContext, body, {
      clientIp: firstHeader(req.headers['x-corvo-client-ip']),
      userAgent: firstHeader(req.headers['user-agent']),
    });
    return data(result);
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
