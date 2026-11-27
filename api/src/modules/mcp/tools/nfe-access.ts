import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import {
  permissionsForTenantRole,
  type TenantPermission,
} from '@/modules/auth/domain/permission';
import { ITenantMembershipRepository } from '@/modules/auth/domain/tenant-membership.repository';
import { CompanyNfeSettingsService } from '@/modules/company/application/company-nfe-settings.service';
import type { InvoiceCall } from '@/modules/fiscal-core/application/invoice-routes';
import type { InvoiceRoutes } from '@/modules/fiscal-core/application/invoice-routes';
import { InvoiceTypeRouter } from '@/modules/fiscal-core/application/invoice-type.router';
import type { InvoiceSummaryQuery } from '@/modules/fiscal-core/infra/typeorm-invoice-summaries';
import { missingMemberPermissionMessage } from '../mcp-client-policy';

/** The document kinds of the fiscal-core routes that are not NFS-e. */
export type McpGoodsType = 'nfe' | 'nfce';

/** `{ data: X }` (the HTTP envelope the shared routes answer) back to `X`. */
export function unwrapData<T>(value: unknown): T {
  if (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    !('pagination' in value)
  )
    return (value as { data: T }).data;
  return value as T;
}

/** What an agent can act on from an HTTP error: the code, the message and the fields. */
export function describeHttpError(error: unknown): Error {
  if (!(error instanceof HttpException)) return error as Error;
  const body = error.getResponse();
  if (typeof body === 'string') return new Error(body);
  const { code, message, details } = body as {
    code?: string;
    message?: unknown;
    details?: { field?: string; code?: string; message?: string }[];
  };
  const text = Array.isArray(message)
    ? message.join('; ')
    : typeof message === 'string'
      ? message
      : error.message;
  const fields = Array.isArray(details)
    ? details
        .map((d) => `${d.field ?? '?'}: ${d.message ?? d.code ?? 'invalid'}`)
        .join('; ')
    : '';
  return new Error(
    [code ? `${code}: ${text}` : text, fields].filter(Boolean).join(' | '),
  );
}

/**
 * How the MCP tools reach NF-e and NFC-e: the shared `/v1/invoices` routes of the type, behind the
 * same member permission the dashboard and the API keys need (`nfe.documents.*` for both). Every
 * workspace has them; production is the only thing still locked (`NFE_PRODUCTION_ENABLED`).
 */
@Injectable()
export class McpNfe {
  constructor(
    private readonly router: InvoiceTypeRouter,
    @Inject(ITenantMembershipRepository)
    private readonly memberships: ITenantMembershipRepository,
    private readonly settings: CompanyNfeSettingsService,
  ) {}

  call(ctx: AuthContext): InvoiceCall {
    return {
      tenantId: ctx.activeTenantId,
      environment: executionEnvironment(ctx),
      auth: ctx,
    };
  }

  /** The role may have changed since the person authorized the connection. */
  private async hasPermission(
    ctx: AuthContext,
    permission: TenantPermission,
  ): Promise<boolean> {
    const membership = await this.memberships.findByAuthUserAndTenant(
      ctx.authUserId,
      ctx.activeTenantId,
    );
    return (
      !!membership?.isActive &&
      permissionsForTenantRole(membership.role).includes(permission)
    );
  }

  private async assertAllowed(
    ctx: AuthContext,
    permission: TenantPermission,
  ): Promise<void> {
    if (!(await this.hasPermission(ctx, permission)))
      throw new Error(missingMemberPermissionMessage(permission));
  }

  /** The routes of the type, after the member permission was checked. */
  async routes(
    ctx: AuthContext,
    permission: TenantPermission,
    type: McpGoodsType = 'nfe',
  ): Promise<InvoiceRoutes> {
    await this.assertAllowed(ctx, permission);
    try {
      return this.router.forType(type, this.call(ctx), permission);
    } catch (error) {
      throw describeHttpError(error);
    }
  }

  /** Runs one call on the routes of the type and turns HTTP errors into readable messages. */
  async run<T>(
    ctx: AuthContext,
    permission: TenantPermission,
    work: (routes: InvoiceRoutes, call: InvoiceCall) => Promise<unknown>,
    type: McpGoodsType = 'nfe',
  ): Promise<T> {
    const routes = await this.routes(ctx, permission, type);
    try {
      return unwrapData<T>(await work(routes, this.call(ctx)));
    } catch (error) {
      throw describeHttpError(error);
    }
  }

  /**
   * Runs one call on the routes of the document that has this id (an NF-e or a NFC-e), so an
   * operation one of them does not have answers with the API's own error.
   */
  async runOwned<T>(
    ctx: AuthContext,
    permission: TenantPermission,
    id: string,
    work: (routes: InvoiceRoutes, call: InvoiceCall) => Promise<unknown>,
  ): Promise<T> {
    await this.assertAllowed(ctx, permission);
    try {
      const call = this.call(ctx);
      const routes = await this.router.owner(id, call, permission);
      if (!routes)
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Resource not found',
        });
      return unwrapData<T>(await work(routes, call));
    } catch (error) {
      throw describeHttpError(error);
    }
  }

  /** NFS-e, NF-e and NFC-e in one list; the last two only when the member may read them. */
  async summaries(ctx: AuthContext, query: Omit<InvoiceSummaryQuery, 'types'>) {
    const withNfe = await this.hasPermission(ctx, 'nfe.documents.view');
    try {
      if (withNfe)
        return await this.router.summaries(query, this.call(ctx), {
          nfse: 'nfse.invoices.view',
          nfe: 'nfe.documents.view',
        });
    } catch (error) {
      throw describeHttpError(error);
    }
    return null;
  }

  /** The NF-e settings of a company, after the member permission was checked. */
  async withSettings<T>(
    ctx: AuthContext,
    permission: 'nfe.documents.view' | 'nfe.documents.manage',
    work: (settings: CompanyNfeSettingsService) => Promise<T>,
  ): Promise<T> {
    await this.assertAllowed(ctx, permission);
    try {
      return await work(this.settings);
    } catch (error) {
      throw describeHttpError(error);
    }
  }
}
