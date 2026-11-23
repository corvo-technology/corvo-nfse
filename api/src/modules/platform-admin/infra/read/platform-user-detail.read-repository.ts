import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PlatformUserDetail } from '../../platform-admin.contract';
import {
  PlatformReadSession,
  type PlatformQuery,
} from '../platform-read-session';

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

/**
 * Everything the platform admin sees about one user and their workspaces.
 * Columns are listed explicitly: key_hash, encrypted_* certificate columns,
 * session tokens and payment_intents.checkout are never selected.
 */
@Injectable()
export class PlatformUserDetailReadRepository {
  private readonly s: string;

  constructor(
    private readonly session: PlatformReadSession,
    @InjectDataSource() dataSource: DataSource,
  ) {
    const schema = (dataSource.options as { schema?: string }).schema;
    this.s = schema ? `"${schema.replaceAll('"', '""')}".` : '';
  }

  find(userId: string): Promise<PlatformUserDetail | null> {
    return this.session.run((q) => this.load(q, userId));
  }

  private async load(
    q: PlatformQuery,
    userId: string,
  ): Promise<PlatformUserDetail | null> {
    const s = this.s;
    const [user] = await q(
      `SELECT id, email, name, email_verified_at, created_at, last_login_at FROM ${s}auth_users WHERE id = $1`,
      [userId],
    );
    if (!user) return null;

    const memberships = await q(
      `SELECT m.tenant_id, m.role, p.slug AS plan_slug, p.name AS plan_name
         FROM ${s}tenant_memberships m
         JOIN ${s}tenants t ON t.id = m.tenant_id
         LEFT JOIN ${s}plans p ON p.id = t.plan_id
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
           FROM ${s}billing_usage_periods
          WHERE tenant_id = ANY($1::uuid[]) AND period_start <= now() AND period_end > now()
          ORDER BY tenant_id, period_start DESC`,
        [tenantIds],
      ),
    );
    const balances = groupByTenant(
      await q(
        `SELECT tenant_id, COALESCE(SUM(amount), 0)::int AS balance
           FROM ${s}credit_transactions
          WHERE tenant_id = ANY($1::uuid[]) AND source IN ('avulso', 'bonus')
          GROUP BY tenant_id`,
        [tenantIds],
      ),
    );
    const companies = groupByTenant(
      await q(
        `SELECT c.tenant_id, c.id, c.tax_id, c.legal_name, c.municipality_code, c.environment,
                (SELECT max(k.valid_until) FROM ${s}nfse_certificates k
                  WHERE k.company_id = c.id AND k.status = 'active' AND k.deleted_at IS NULL) AS certificate_valid_until
           FROM ${s}nfse_companies c
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
             FROM ${s}nfse_invoices WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const credits = groupByTenant(
      await q(
        `SELECT tenant_id, id, type, source, amount, description, created_at FROM (
           SELECT tenant_id, id, type, source, amount, description, created_at,
                  row_number() OVER (PARTITION BY tenant_id ORDER BY created_at DESC, id DESC) AS rn
             FROM ${s}credit_transactions WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const payments = groupByTenant(
      await q(
        `SELECT tenant_id, id, kind, provider, amount_cents, status, paid_at FROM (
           SELECT tenant_id, id, kind, provider, amount_cents, status, paid_at, created_at,
                  row_number() OVER (PARTITION BY tenant_id ORDER BY created_at DESC, id DESC) AS rn
             FROM ${s}payment_intents WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const apiKeys = groupByTenant(
      await q(
        `SELECT tenant_id, id, name, key_prefix, environment, last_used_at FROM (
           SELECT tenant_id, id, name, key_prefix, environment, last_used_at, created_at,
                  row_number() OVER (PARTITION BY tenant_id ORDER BY created_at DESC, id DESC) AS rn
             FROM ${s}api_keys WHERE tenant_id = ANY($1::uuid[])
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY created_at DESC, id DESC`,
        [tenantIds],
      ),
    );
    const mcp = groupByTenant(
      await q(
        `SELECT tenant_id, id, client_name, last_used_at FROM (
           SELECT c.tenant_id, c.id, COALESCE(o.name, c.client_id) AS client_name, c.last_used_at,
                  row_number() OVER (PARTITION BY c.tenant_id ORDER BY c.granted_at DESC, c.id DESC) AS rn
             FROM ${s}mcp_connections c
             LEFT JOIN ${s}auth_oauth_clients o ON o.id = c.client_id
            WHERE c.tenant_id = ANY($1::uuid[]) AND c.auth_user_id = $2 AND c.revoked_at IS NULL
         ) x WHERE rn <= ${LIST_LIMIT} ORDER BY rn`,
        [tenantIds, userId],
      ),
    );

    const workspaces: Workspace[] = memberships.map((m) => {
      const tenantId = m.tenant_id as string;
      const u = usage.get(tenantId)?.[0];
      return {
        tenantId,
        role: m.role as string,
        isOwn: tenantId === userId,
        plan: m.plan_slug
          ? { slug: m.plan_slug as string, name: m.plan_name as string }
          : null,
        usage: u
          ? {
              included: Number(u.included),
              authorized: Number(u.authorized),
              reserved: Number(u.reserved),
              periodEnd: iso(u.period_end)!,
            }
          : null,
        avulsoBalance: Number(balances.get(tenantId)?.[0]?.balance ?? 0),
        companies: (companies.get(tenantId) ?? []).map((c) => ({
          id: c.id as string,
          taxId: c.tax_id as string,
          legalName: c.legal_name as string,
          municipalityCode: c.municipality_code as string,
          environment: c.environment as string,
          certificateValidUntil: iso(c.certificate_valid_until),
        })),
        recentInvoices: (invoices.get(tenantId) ?? []).map((i) => ({
          id: i.id as string,
          status: i.status as string,
          amount: Number(i.amount),
          environment: i.environment as string,
          lastErrorCode: (i.last_error_code as string | null) ?? null,
          createdAt: iso(i.created_at)!,
        })),
        credits: (credits.get(tenantId) ?? []).map((c) => ({
          id: c.id as string,
          type: c.type as string,
          source: (c.source as string | null) ?? null,
          amount: Number(c.amount),
          description: (c.description as string | null) ?? null,
          createdAt: iso(c.created_at)!,
        })),
        payments: (payments.get(tenantId) ?? []).map((p) => ({
          id: p.id as string,
          kind: p.kind as string,
          provider: p.provider as string,
          amountCents: Number(p.amount_cents),
          status: p.status as string,
          paidAt: iso(p.paid_at),
        })),
        apiKeys: (apiKeys.get(tenantId) ?? []).map((k) => ({
          id: k.id as string,
          name: k.name as string,
          keyPrefix: k.key_prefix as string,
          environment: k.environment as string,
          lastUsedAt: iso(k.last_used_at),
        })),
        mcpConnections: (mcp.get(tenantId) ?? []).map((c) => ({
          id: c.id as string,
          clientName: c.client_name as string,
          lastUsedAt: iso(c.last_used_at),
        })),
      };
    });

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
