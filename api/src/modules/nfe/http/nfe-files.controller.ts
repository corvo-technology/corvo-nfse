import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { NfeRoute } from '@/modules/fiscal-core/http/nfe-enabled.guard';
import { data } from '@/shared/http/response';
import { RawResponse } from '@/shared/http/response.interceptor';
import { NfeFilesService } from '../application/nfe-files.service';
import { NfeDownloadUrlDto } from './nfe-files.dto';

/** The XML (`nfeProc`) and the DANFE of an NF-e, and the signed links to them. */
@UseGuards(ExecutionEnvironmentGuard)
@NfeRoute()
@ApiTags('nfe')
@Controller('nfe')
export class NfeFilesController {
  constructor(private readonly files: NfeFilesService) {}

  @RawResponse()
  @Get(':id/xml')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'Download the NF-e XML (nfeProc)' })
  async xml(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const context = req.authContext!;
    const file = await this.files.read(
      id,
      context.activeTenantId,
      executionEnvironment(context),
      'xml',
    );
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    return file.body.toString('utf8');
  }

  @RawResponse()
  @Get(':id/pdf')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'Download the DANFE (PDF)' })
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const context = req.authContext!;
    const file = await this.files.read(
      id,
      context.activeTenantId,
      executionEnvironment(context),
      'pdf',
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
    return new StreamableFile(file.body);
  }

  @Post(':id/download-url')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({
    summary: 'Get a signed download URL for the NF-e XML or DANFE',
  })
  async downloadUrl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NfeDownloadUrlDto,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const context = req.authContext!;
    const result = await this.files.downloadUrl(
      id,
      context.activeTenantId,
      executionEnvironment(context),
      dto.format,
    );
    res.setHeader('Cache-Control', 'no-store');
    return data({
      downloadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      fileName: result.fileName,
      mimeType: result.mimeType,
    });
  }
}
