import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { data } from '@/shared/http/response';
import { RawResponse } from '@/shared/http/response.interceptor';
import {
  InvoicePackageService,
  parseInclude,
  parseMonth,
  type PackageInclude,
} from '../application/package/invoice-package.service';
import {
  PackageLinkService,
  type PackageScope,
} from '../application/package/package-link.service';

const HOUR_MS = 3_600_000;

async function sendZip(
  packages: InvoicePackageService,
  scope: PackageScope,
  include: PackageInclude,
  res: Response,
): Promise<StreamableFile> {
  const { fileName, stream } = await packages.open(scope, include);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(stream);
}

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('invoices')
@Controller('companies/:companyId/invoice-package')
export class InvoicePackageController {
  constructor(private readonly packages: InvoicePackageService) {}

  @Get('summary')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({
    summary: 'Count and total of the month package, without building it',
  })
  @ApiOkResponse({ description: 'month, count, total, limit' })
  async summary(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Query('month') month: string,
    @Req() req: RequestWithAuthContext,
  ) {
    parseMonth(month);
    const auth = req.authContext!;
    return data(
      await this.packages.summary({
        tenantId: auth.activeTenantId,
        companyId,
        environment: executionEnvironment(auth),
        month,
      }),
    );
  }

  @RawResponse()
  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @Throttle({ default: { limit: 10, ttl: HOUR_MS } })
  @ApiOperation({
    summary: 'Download the month package (ZIP with xml/, pdf/ and resumo.csv)',
    description:
      'Authorized and cancelled notes by competence month, at most 500 (422 PACKAGE_TOO_LARGE above that). resumo.csv is the last file of the ZIP: a ZIP without it is incomplete. 10 packages per hour per workspace.',
  })
  async download(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Query('month') month: string,
    @Query('include') include: string | undefined,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    parseMonth(month);
    const auth = req.authContext!;
    return sendZip(
      this.packages,
      {
        tenantId: auth.activeTenantId,
        companyId,
        environment: executionEnvironment(auth),
        month,
      },
      parseInclude(include),
      res,
    );
  }
}

/** Opened from the e-mail or MCP link: no login, valid only for the package the token names. */
@ApiTags('invoices')
@Controller('invoice-package-links')
export class InvoicePackageLinkController {
  constructor(
    private readonly packages: InvoicePackageService,
    private readonly links: PackageLinkService,
  ) {}

  @RawResponse()
  @PublicRoute()
  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: HOUR_MS } })
  @ApiOperation({ summary: 'Download a month package from a temporary link' })
  async download(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendZip(
      this.packages,
      this.links.verify(token),
      ['xml', 'pdf'],
      res,
    );
  }
}
