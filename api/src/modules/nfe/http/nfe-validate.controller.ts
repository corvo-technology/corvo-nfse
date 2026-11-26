import {
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
  NfeValidateService,
  type NfeValidationResult,
} from '../application/nfe-validate.service';
import { NfeRequestDto } from './nfe.dto';

@UseGuards(ExecutionEnvironmentGuard)
@NfeRoute()
@ApiTags('nfe')
@Controller('nfe')
export class NfeValidateController {
  constructor(private readonly service: NfeValidateService) {}

  @Post('validate')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.issue')
  @ApiOperation({ summary: 'Validate an NF-e without sending it' })
  @ApiQuery({ name: 'includeXml', required: false, type: Boolean })
  async validate(
    @Body() dto: NfeRequestDto,
    @Query('includeXml') includeXml: string | undefined,
    @Req() req: RequestWithAuthContext,
  ) {
    const context = req.authContext!;
    return data<NfeValidationResult>(
      await this.service.validate(
        context.activeTenantId,
        executionEnvironment(context),
        dto,
        includeXml === 'true',
      ),
    );
  }
}
