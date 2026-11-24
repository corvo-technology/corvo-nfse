import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches } from 'class-validator';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { data } from '@/shared/http/response';
import { AccountantPackageService } from '../application/package/accountant-package.service';

export class UpdateAccountantPackageDto {
  /** null or blank turns the monthly send off. */
  @IsOptional() @IsString() accountantEmail?: string | null;
}

export class SendAccountantPackageDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
}

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('companies')
@Controller('companies/:companyId/accountant-package')
export class AccountantPackageController {
  constructor(private readonly accountant: AccountantPackageService) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.view')
  @ApiOperation({ summary: 'Accountant e-mail of the monthly package' })
  async get(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return data(
      await this.accountant.getSettings(
        auth.activeTenantId,
        companyId,
        executionEnvironment(auth),
      ),
    );
  }

  @Get('sends')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.view')
  @ApiOperation({
    summary: 'Last 12 attempts to send the package to the accountant',
    description:
      'status is sent (queued for e-mail, not proof of delivery), skipped-empty, skipped-too-large or failed.',
  })
  async sends(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return data(
      await this.accountant.listSends(
        auth.activeTenantId,
        companyId,
        executionEnvironment(auth),
      ),
    );
  }

  @Put()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary: 'Set the accountant e-mail (null turns the monthly send off)',
  })
  async update(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() dto: UpdateAccountantPackageDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return data(
      await this.accountant.setEmail(
        auth.activeTenantId,
        companyId,
        executionEnvironment(auth),
        dto.accountantEmail ?? null,
      ),
    );
  }

  @Post('send')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Send the package of a month to the accountant now',
    description:
      'status is sent, or skipped-test, skipped-no-email, skipped-empty or skipped-too-large with nothing sent.',
  })
  async send(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() dto: SendAccountantPackageDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return data({
      status: await this.accountant.sendNow(
        auth.activeTenantId,
        companyId,
        executionEnvironment(auth),
        dto.month,
        auth.apiKeyEnvironment || auth.mcpConnectionId
          ? 'mcp-or-api'
          : 'manual',
      ),
    });
  }
}
