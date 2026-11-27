import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PlatformUserDetail } from '../../platform-admin.contract';
import {
  PlatformReadSession,
  type PlatformQuery,
} from '../platform-read-session';
import { schemaQualifier } from './schema-qualifier';

type Workspace = PlatformUserDetail['workspaces'][number];
type Row = Record<string, unknown>;

const LIST_LIMIT = 20;

function iso(value: unknown): string | null {
  return value == null ? null : new Date(value as string | Date).toISOString();
}

function groupByTenant<T extends Row>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.tenant_id as string;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

type TenantLists = Record<
  | 'usage'
  | 'balances'
  | 'companies'
  | 'invoices'
  | 'credits'
  | 'payments'
  | 'apiKeys'
  | 'mcp',
  Map<string, Row[]>
>;

const str = (v: unknown) => v as string;
const strOrNull = (v: unknown) => (v as string | null) ?? null;

function toPlan(m: Row): Workspace['plan'] {
  return m.plan_slug
    ? { slug: str(m.plan_slug), name: str(m.plan_name) }
    : null;
}

function toUsage(u: Row | undefined): Workspace['usage'] {
  if (!u) return null;
  return {
    included: Number(u.included),
    authorized: Number(u.authorized),
    reserved: Number(u.reserved),
    periodEnd: iso(u.period_end)!,
  };
}

const toCompany = (c: Row): Workspace['companies'][number] => ({
  id: str(c.id),
  taxId: str(c.tax_id),
  legalName: str(c.legal_name),
  municipalityCode: str(c.municipality_code),
  environment: str(c.environment),
  certificateValidUntil: iso(c.certificate_valid_until),
});

const toInvoice = (i: Row): Workspace['recentInvoices'][number] => ({
  id: str(i.id),
  status: str(i.status),
  amount: Number(i.amount),
  environment: str(i.environment),
  lastErrorCode: strOrNull(i.last_error_code),
  createdAt: iso(i.created_at)!,
});

const toCredit = (c: Row): Workspace['credits'][number] => ({
  id: str(c.id),
  type: str(c.type),
  source: strOrNull(c.source),
  amount: Number(c.amount),
  description: strOrNull(c.description),
  createdAt: iso(c.created_at)!,
});

const toPayment = (p: Row): Workspace['payments'][number] => ({
  id: str(p.id),
  kind: str(p.kind),
  provider: str(p.provider),
  amountCents: Number(p.amount_cents),
  status: str(p.status),
  paidAt: iso(p.paid_at),
});

const toApiKey = (k: Row): Workspace['apiKeys'][number] => ({
  id: str(k.id),
  name: str(k.name),
  keyPrefix: str(k.key_prefix),
  environment: str(k.environment),
  lastUsedAt: iso(k.last_used_at),
});

const toMcp = (c: Row): Workspace['mcpConnections'][number] => ({
  id: str(c.id),
  clientName: str(c.client_name),
  lastUsedAt: iso(c.last_used_at),
});

function toWorkspace(m: Row, userId: string, l: TenantLists): Workspace {
  const tenantId = str(m.tenant_id);
  const rows = (map: Map<string, Row[]>) => map.get(tenantId) ?? [];
  return {
    tenantId,
    role: str(m.role),
    isOwn: tenantId === userId,
    plan: toPlan(m),
    usage: toUsage(rows(l.usage)[0]),
    avulsoBalance: Number(rows(l.balances)[0]?.balance ?? 0),
    companies: rows(l.companies).map(toCompany),
    recentInvoices: rows(l.invoices).map(toInvoice),
    credits: rows(l.credits).map(toCredit),
    payments: rows(l.payments).map(toPayment),
    apiKeys: rows(l.apiKeys).map(toApiKey),
    mcpConnections: rows(l.mcp).map(toMcp),
  };
}

/**
 * Everything the platform admin sees about one user and their workspaces.
 * Columns are listed explicitly: key_hash, encrypted_* certificate columns,
 * session tokens and payment_intents.checkout are never selected.
 */
@Injectable()
export class PlatformUserDetailReadRepository {
  private readonly t: (table: string) => string;

  constructor(
    private readonly session: PlatformReadSession,
    @InjectDataSource() dataSource: DataSource,
  ) {
    this.t = schemaQualifier(dataSource);
  }

  find(userId: string): Promise<PlatformUserDetail | null> {
    return this.session.run((q) => this.load(q, userId));
  }

  private async load(
    q: PlatformQuery,
    userId: string,
  ): Promise<PlatformUserDetail | null> {
    const t = this.t;
    const [user] = await q(
      `SELECT id, email, name, email_verified_at, created_at, last_login_at FROM ${t('auth_users')} WHERE id = $1`,
      [userId],
    );
    if (!user) return null;

    const memberships = await q(
      `SELECT m.tenant_id, m.role, p.slug AS plan_slug, p.name AS plan_name
         FROM ${t('tenant_memberships')} m
         JOIN ${t('tenants')} t ON t.id = m.tenant_id
         LEFT JOIN ${t('plans')} p ON p.id = t.plan_id
        WHERE m.auth_user_id = $1 AND m.is_active
        ORDER BY (m.tenant_id = $1) DESC, m.created_at ASC`,
      [userId],
    );
    const tenantIds = memberships.map((m) => m.tenant_id as string);
    if (tenantIds.length === 0) {
      return { user: this.mapUser(user), workspaces: [] };
    }

    const usage = groupByTenant(
      await q(
        `SELECT DISTINCT ON (tenant_id) tenant_id, included, authorized, reserved, period_end
           FROM ${t('billing_usage_periods')}
          WHERE tenant_id = ANY($1::uuid[]) AND period_start <= now() AND period_end > now()
          ORDER BY tenant_id, period_start DESC`,
        [tenantIds],
      ),
    );
    const balances = groupByTenant(
      await q(
        `SELECT tenant_id, COALESCE(SUM(amount), 0)::int AS balance
           FROM ${t('credit_transactions')}
          WHERE tenant_id = ANY($1::uuid[]) AND source IN ('avulso', 'bonus')
          GROUP BY tenant_id`,
        [tenantIds],
      ),
    );
    const companies = groupByTenant(
      await q(
        `SELECT c.tenant_id, c.id, c.tax_id, c.legal_name, c.municipality_code, c.environment,
                (SELECT max(k.valid_until) FROM ${t('nfse_certificates')} k
                  WHERE k.company_id = c.id AND k.status = 'active' AND k.deleted_at IS NULL) AS certificate_valid_until
           FROM ${t('nfse_companies')} c
          WHERE c.tenant_id = ANY($1::uuid[]) AND c.deleted_at IS NULL
          ORDER BY c.created_at ASC`,
        [tenantIds],
      ),
    );
    const invoices = groupByTenant(
      await q(
        `SELECT tenant_id, id, status, amount, environment, last_error_code, created_at FROM (
           SELECT tenant_id, id, status, amount, environment, last_error_code, created_at,
                  row_number() OVER (PARTITION BY tenant_id ORDER BY created_at DESC, id DESC) AS rn
             FROM ${t('nfse_invoices')} WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const credits = groupByTenant(
      await q(
        `SELECT tenant_id, id, type, source, amount, description, created_at FROM (
           SELECT tenant_id, id, type, source, amount, description, created_at,
                  row_number() OVER (PARTITION BY tenant_id ORDER BY created_at DESC, id DESC) AS rn
             FROM ${t('credit_transactions')} WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const payments = groupByTenant(
      await q(
        `SELECT tenant_id, id, kind, provider, amount_cents, status, paid_at FROM (
           SELECT tenant_id, id, kind, provider, amount_cents, status, paid_at, created_at,
                  row_number() OVER (PARTITION BY tenant_id ORDER BY created_at DESC, id DESC) AS rn
             FROM ${t('payment_intents')} WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const apiKeys = groupByTenant(
      await q(
        `SELECT tenant_id, id, name, key_prefix, environment, last_used_at FROM (
           SELECT tenant_id, id, name, key_prefix, environment, last_used_at, created_at,
                  row_number() OVER (PARTITION BY tenant_id ORDER BY created_at DESC, id DESC) AS rn
             FROM ${t('api_keys')} WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const mcp = groupByTenant(
      await q(
        `SELECT tenant_id, id, client_name, last_used_at FROM (
           SELECT c.tenant_id, c.id, COALESCE(o.name, c.client_id) AS client_name, c.last_used_at,
                  row_number() OVER (PARTITION BY c.tenant_id ORDER BY c.granted_at DESC, c.id DESC) AS rn
             FROM ${t('mcp_connections')} c
             LEFT JOIN ${t('auth_oauth_clients')} o ON o.id = c.client_id
            WHERE c.tenant_id = ANY($1::uuid[]) AND c.auth_user_id = $2 AND c.revoked_at IS NULL
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY rn`,
        [tenantIds, userId],
      ),
    );

    const lists: TenantLists = {
      usage,
      balances,
      companies,
      invoices,
      credits,
      payments,
      apiKeys,
      mcp,
    };
    const workspaces = memberships.map((m) => toWorkspace(m, userId, lists));

    return { user: this.mapUser(user), workspaces };
  }

  private mapUser(user: Row): PlatformUserDetail['user'] {
    return {
      id: user.id as string,
      email: user.email as string,
      name: user.name as string,
      emailVerifiedAt: iso(user.email_verified_at),
      createdAt: iso(user.created_at)!,
      lastLoginAt: iso(user.last_login_at),
    };
  }
}
