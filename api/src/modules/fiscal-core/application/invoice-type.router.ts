import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RoutePermissionService } from '@/modules/auth/application/route-permission.service';
import type { TenantPermission } from '@/modules/auth/domain/permission';
import type { CursorPage } from '@/shared/http/pagination';
import type { InvoiceType } from '../domain/invoice-type';
import {
  TypeormInvoiceSummaries,
  type InvoiceSummary,
  type InvoiceSummaryQuery,
} from '../infra/typeorm-invoice-summaries';
import { NfeAccessPolicy } from './nfe-access.policy';
import type { InvoiceCall, InvoiceRoutes } from './invoice-routes';

/** The permission each kind of document needs for one operation. */
export interface InvoiceGate {
  nfse: TenantPermission;
  nfe: TenantPermission;
}

/** 422: the operation exists, but not for this kind of document. */
export function invoiceOperationNotSupported(
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INVOICE_OPERATION_NOT_SUPPORTED',
    message,
  });
}

function denied(permission: TenantPermission): ForbiddenException {
  return new ForbiddenException({
    code: 'PERMISSION_DENIED',
    message: `One of these permissions is required: "${permission}"`,
  });
}

/**
 * Sends a `/v1/invoices` call to the document type it is about. NFS-e stays in its own handlers
 * (the `nfse` callbacks); every other type registers its `InvoiceRoutes` here.
 *
 * The type comes from the request (`type` in the body or query, NFS-e when absent) or, for a
 * route with an `id`, from the document that has the id. The permission of the type is checked
 * here, so a key that can only read NF-e never reaches an NFS-e, and the other way around.
 */
@Injectable()
export class InvoiceTypeRouter {
  private readonly permissions = new RoutePermissionService();
  private readonly routes = new Map<InvoiceType, InvoiceRoutes>();

  constructor(
    private readonly access: NfeAccessPolicy,
    private readonly summaryQuery: TypeormInvoiceSummaries,
  ) {}

  register(routes: InvoiceRoutes): void {
    if (this.routes.has(routes.type))
      throw new Error(`Invoice routes already registered for ${routes.type}`);
    this.routes.set(routes.type, routes);
  }

  allows(call: InvoiceCall, permission: TenantPermission): boolean {
    return this.permissions.hasPermission(call.auth, permission);
  }

  /** The NFS-e callbacks only run for a key that may use them (the guard lets either type in). */
  assertNfse(call: InvoiceCall, gate: InvoiceGate): void {
    if (!this.allows(call, gate.nfse)) throw denied(gate.nfse);
  }

  /** The routes of a type the caller asked for: 404 while NF-e is not released, as before. */
  async forType(
    type: Exclude<InvoiceType, 'nfse'>,
    call: InvoiceCall,
    permission: TenantPermission,
  ): Promise<InvoiceRoutes> {
    const routes = this.routes.get(type);
    if (!routes || !(await this.access.isEnabled(call.tenantId, type)))
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    if (!this.allows(call, permission)) throw denied(permission);
    return routes;
  }

  /** By the `type` of the request: NFS-e when absent. */
  async byType<T>(
    type: InvoiceType | undefined,
    call: InvoiceCall,
    gate: InvoiceGate,
    nfse: () => Promise<T>,
    other: (routes: InvoiceRoutes) => Promise<T>,
  ): Promise<T> {
    if (type === 'nfe' || type === 'nfce')
      return other(await this.forType(type, call, gate.nfe));
    this.assertNfse(call, gate);
    return nfse();
  }

  /**
   * The routes of the non-NFS-e document that has this id, or null: no such document, NF-e not
   * released for the workspace, or a key that cannot use that type (it then sees what an NFS-e
   * key sees, that the id is unknown).
   */
  async owner(
    id: string,
    call: InvoiceCall,
    permission: TenantPermission,
  ): Promise<InvoiceRoutes | null> {
    if (!this.allows(call, permission)) return null;
    if (this.routes.size === 0) return null;
    for (const routes of this.routes.values()) {
      if (!(await this.access.isEnabled(call.tenantId, routes.type))) continue;
      if (await routes.owns(id, call)) return routes;
    }
    return null;
  }

  /** By the document that has the id. Only a tenant with NF-e released pays the extra lookup. */
  async byId<T>(
    id: string,
    call: InvoiceCall,
    gate: InvoiceGate,
    nfse: () => Promise<T>,
    other: (routes: InvoiceRoutes) => Promise<T>,
  ): Promise<T> {
    const routes = await this.owner(id, call, gate.nfe);
    if (routes) return other(routes);
    this.assertNfse(call, gate);
    return nfse();
  }

  /** `type=all`: the documents of every type the key can read, as one list. */
  async summaries(
    query: Omit<InvoiceSummaryQuery, 'types'>,
    call: InvoiceCall,
    gate: InvoiceGate,
  ): Promise<CursorPage<InvoiceSummary>> {
    const types: InvoiceType[] = [];
    if (this.allows(call, gate.nfse)) types.push('nfse');
    if (this.allows(call, gate.nfe))
      for (const type of ['nfe', 'nfce'] as const)
        if (
          this.routes.has(type) &&
          (await this.access.isEnabled(call.tenantId, type))
        )
          types.push(type);
    if (types.length === 0) throw denied(gate.nfse);
    return this.summaryQuery.list(
      { ...query, types },
      call.tenantId,
      call.environment,
    );
  }
}
