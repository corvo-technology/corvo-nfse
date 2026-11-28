import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { data } from '@/shared/http/response';
import {
  CompanyNfeSettingsService,
  type NfeReadinessView,
} from '../application/company-nfe-settings.service';

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('companies')
@Controller('companies/:id/nfe-readiness')
export class CompanyNfeReadinessController {
  constructor(private readonly service: CompanyNfeSettingsService) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({
    summary: 'Can the company issue NF-e and NFC-e? Checked at the SEFAZ',
  })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    return data<NfeReadinessView>(
      await this.service.readiness(
        id,
        context.activeTenantId,
        executionEnvironment(context),
      ),
    );
  }
}
