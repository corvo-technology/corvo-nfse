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
import { InvoiceResponseDto } from './invoice-response.dto';
import { InvoiceOverviewService } from '../application/invoice-overview.service';
import {
  InvoiceOverviewQuery,
  InvoiceOverviewResponseDto,
  OverviewNfeItemDto,
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
    summary:
      'Get the overview of all notes (NFS-e, NF-e, NFC-e) for the tenant and execution environment',
    description:
      'Exactly 7 or 30 calendar days including today in America/Sao_Paulo. Notes of every type (NFS-e, NF-e and NFC-e) are counted together. Counts and up to 5 recent notes use creation time and current status (`denied` counts as rejected). Daily activity counts currently authorized notes by authorization time, including invoices created earlier. Credits are available separately from billing.',
  })
  @ApiExtraModels(
    InvoiceOverviewResponseDto,
    InvoiceResponseDto,
    OverviewNfeItemDto,
  )
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
      .get(
        auth.activeTenantId,
        executionEnvironment(auth),
        // The documented default; the query object is not always an instance of the DTO.
        query.period ?? '7d',
      )
      .then(data);
  }
}
