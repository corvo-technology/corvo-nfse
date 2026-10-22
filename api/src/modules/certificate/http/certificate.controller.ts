import { Throttle } from '@nestjs/throttler';
import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import {
  Controller,
  UseGuards,
  Get,
  Query,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { CertificateService } from '../application/certificate.service';
import {
  UploadCertificateDto,
  CertificateResponseDto,
} from './certificate.dto';
import type { CertificateMetadata } from '../domain/certificate';

interface UploadedFileDto {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('certificates')
@Controller('companies/:companyId/certificates')
export class CertificateController {
  constructor(private readonly certService: CertificateService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.certificates.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 }, // 50KB
    }),
  )
  @ApiOperation({ summary: 'Upload a PKCS#12 certificate for NFS-e' })
  async upload(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Req() req: RequestWithAuthContext,
    @UploadedFile() file: UploadedFileDto,
    @Body() body: UploadCertificateDto,
  ) {
    if (!file) {
      throw new BadRequestException('Certificate file is required');
    }
    if (!body.password) {
      throw new BadRequestException('Certificate password is required');
    }

    const tenantId = req.authContext!.activeTenantId;
    const metadata = await this.certService.upload(
      companyId,
      tenantId,
      file.buffer,
      body.password,
      executionEnvironment(req.authContext!),
    );

    return this.toResponse(metadata);
  }

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.certificates.view')
  @ApiOperation({ summary: 'List certificates for a company' })
  @ApiCursorResponse()
  async list(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const certs = await this.certService.listPage(
      companyId,
      tenantId,
      executionEnvironment(req.authContext!),
      options,
    );
    return certs.map((c) => this.toResponse(c));
  }

  @Delete(':certId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.certificates.manage')
  @ApiOperation({ summary: 'Revoke and delete a certificate' })
  async revoke(
    @Param('companyId', new ParseUUIDPipe()) _companyId: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    await this.certService.revoke(
      certId,
      tenantId,
      executionEnvironment(req.authContext!),
      _companyId,
    );
  }

  private toResponse(m: CertificateMetadata): CertificateResponseDto {
    return {
      id: m.id,
      companyId: m.companyId,
      serialNumber: m.serialNumber,
      issuer: m.issuer,
      subject: m.subject,
      fingerprint: m.fingerprint,
      validFrom: m.validFrom,
      validUntil: m.validUntil,
      status: m.status,
      createdAt: m.createdAt,
    };
  }
}
