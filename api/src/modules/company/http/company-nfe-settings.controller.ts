import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
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
import { NfeRoute } from '@/modules/fiscal-core/http/nfe-enabled.guard';
import { data } from '@/shared/http/response';
import {
  CompanyNfeSettingsService,
  type NfeSettingsView,
} from '../application/company-nfe-settings.service';
import { UpdateCompanyNfeSettingsDto } from './company-nfe-settings.dto';

@UseGuards(ExecutionEnvironmentGuard)
@NfeRoute()
@ApiTags('companies')
@Controller('companies/:id/nfe-settings')
export class CompanyNfeSettingsController {
  constructor(private readonly service: CompanyNfeSettingsService) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'Get the NF-e settings of the company' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    return data<NfeSettingsView>(
      await this.service.get(
        id,
        context.activeTenantId,
        executionEnvironment(context),
      ),
    );
  }

  @Put()
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Set the NF-e settings of the company' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCompanyNfeSettingsDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    return data<NfeSettingsView>(
      await this.service.update(
        id,
        context.activeTenantId,
        executionEnvironment(context),
        dto,
      ),
    );
  }
}
