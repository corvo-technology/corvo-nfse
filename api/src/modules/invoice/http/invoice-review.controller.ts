import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { data } from '@/shared/http/response';
import { FiscalPortalBreaker } from '../application/fiscal-portal-breaker';
import { PortalReachabilityStore } from '@/modules/portal-reachability/reachability.store';
import { InvoiceReviewService } from '../application/invoice-review.service';
import { ReviewInvoicesDto } from './invoice-review.dto';

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('invoices')
@Controller()
export class InvoiceReviewController {
  constructor(
    private readonly review: InvoiceReviewService,
    private readonly portal: FiscalPortalBreaker,
    private readonly reachability: PortalReachabilityStore,
  ) {}

  @Post('invoices/review')
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Resolve invoices in manual review (up to 100): retry or discard',
    description:
      'retry sends the invoice again with the same DPS: the portal is asked for that DPS first, so it never issues a second NFS-e. discard rejects the invoice (refunding its credit) only after the portal confirms the DPS was never registered; if the NFS-e exists the invoice becomes authorized. Invoices not in manual_review are skipped. Follow the result through the invoice webhooks.',
  })
  async apply(
    @Body() dto: ReviewInvoicesDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    const results = await this.review.apply(
      auth.activeTenantId,
      executionEnvironment(auth),
      dto.action,
      dto.invoiceIds,
      auth.userId ?? 'api-key',
    );
    return data({ results });
  }

  @Get('fiscal-portal/status')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({
    summary:
      'Whether the national NFS-e portal is answering for this environment',
    description:
      'available is false while emission is paused because the portal stopped answering; invoices wait in the queue and are sent once it answers again. connection says what the connection tests see: ok, portal_down (the portal is down), or a problem on the Corvo side (gov_unreachable_from_us, no_internet, emission_failures); invoices wait in the queue in every case.',
  })
  async portalStatus(@Req() req: RequestWithAuthContext) {
    const [status, connection, authorities] = await Promise.all([
      this.portal.status(executionEnvironment(req.authContext!)),
      this.reachability
        .current()
        .catch((): { state: 'ok'; since: null; ourSide: false } => ({
          state: 'ok',
          since: null,
          ourSide: false,
        })),
      this.portal.authorities(),
    ]);
    return data({ ...status, connection, authorities });
  }
}
