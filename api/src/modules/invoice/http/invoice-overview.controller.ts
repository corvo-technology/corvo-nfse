import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { data } from '@/shared/http/response';
import { InvoiceOverviewService } from '../application/invoice-overview.service';
import {
  InvoiceOverviewQuery,
  InvoiceOverviewResponseDto,
} from './invoice-overview.dto';

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('invoices')
@Controller('invoices')
export class InvoiceOverviewController {
  constructor(private readonly overview: InvoiceOverviewService) {}

  @Get('overview')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({
    summary: 'Get invoice overview for the tenant and execution environment',
    description:
      'Exactly 7 or 30 calendar days including today in America/Sao_Paulo. Counts and up to 5 recent invoices use creation time and current status. Daily activity counts currently authorized invoices by authorization time, including invoices created earlier. Credits are available separately from billing.',
  })
  @ApiExtraModels(InvoiceOverviewResponseDto)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { $ref: getSchemaPath(InvoiceOverviewResponseDto) },
      },
    },
  })
  get(
    @Query() query: InvoiceOverviewQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return this.overview
      .get(auth.activeTenantId, executionEnvironment(auth), query.period)
      .then(data);
  }
}
