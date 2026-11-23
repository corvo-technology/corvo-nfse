import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PlatformAttention } from '../../platform-admin.contract';
import { PlatformReadSession } from '../platform-read-session';

export const STALE_INVOICE_MINUTES = 60;
export const CERTIFICATE_DAYS = 15;
export const WEBHOOK_WINDOW_HOURS = 24;
export const FAILED_PAYMENT_DAYS = 30;
const LIST_LIMIT = 100;

type Stamp = Date | string;
const iso = (value: Stamp): string => new Date(value).toISOString();

/** Read-only "needs attention" lists across all tenants (admin panel). */
@Injectable()
export class PlatformAttentionReadRepository {
  private readonly schema: string;

  constructor(
    private readonly session: PlatformReadSession,
    @InjectDataSource() dataSource: DataSource,
  ) {
    const options = dataSource.options;
    const schema =
      ('schema' in options && typeof options.schema === 'string'
        ? options.schema
        : undefined) ?? 'corvo';
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema))
      throw new Error('Invalid PostgreSQL schema name');
    this.schema = schema;
  }

  private t(name: string): string {
    return `"${this.schema}"."${name}"`;
  }

  snapshot(now: Date): Promise<PlatformAttention> {
    // Oldest active admin of the tenant; callers fall back to the tenant id.
    const owner = `owner AS (
      SELECT DISTINCT ON (tenant_id) tenant_id, auth_user_id
      FROM ${this.t('tenant_memberships')}
      WHERE role = 'admin' AND is_active = true
      ORDER BY tenant_id, created_at, id
    )`;
    return this.session.run(async (q) => {
      const stale = await q<{
        invoice_id: string;
        tenant_id: string;
        user_id: string;
        status: string;
        updated_at: Stamp;
      }>(
        `WITH ${owner}
         SELECT i.id AS invoice_id, i.tenant_id, COALESCE(o.auth_user_id, i.tenant_id) AS user_id,
                i.status, i.updated_at
         FROM ${this.t('nfse_invoices')} i
         LEFT JOIN owner o ON o.tenant_id = i.tenant_id
         WHERE i.status IN ('manual_review', 'reconciliation_required', 'retry_pending')
           AND i.updated_at < $1::timestamptz - interval '${STALE_INVOICE_MINUTES} minutes'
         ORDER BY i.updated_at ASC, i.id
         LIMIT ${LIST_LIMIT}`,
        [now],
      );
      const certificates = await q<{
        company_id: string;
        tenant_id: string;
        user_id: string;
        tax_id: string;
        valid_until: Stamp;
      }>(
        `WITH ${owner}
         SELECT co.id AS company_id, co.tenant_id, COALESCE(o.auth_user_id, co.tenant_id) AS user_id,
                co.tax_id, c.valid_until
         FROM ${this.t('nfse_certificates')} c
         JOIN ${this.t('nfse_companies')} co ON co.id = c.company_id
         LEFT JOIN owner o ON o.tenant_id = co.tenant_id
         WHERE c.status = 'active' AND c.deleted_at IS NULL AND co.deleted_at IS NULL
           AND c.valid_until < $1::timestamptz + interval '${CERTIFICATE_DAYS} days'
         ORDER BY c.valid_until ASC, co.id
         LIMIT ${LIST_LIMIT}`,
        [now],
      );
      const webhooks = await q<{
        tenant_id: string;
        user_id: string;
        failed_count: string | number;
        last_failure_at: Stamp;
      }>(
        `WITH ${owner}
         SELECT d.tenant_id, COALESCE(o.auth_user_id, d.tenant_id) AS user_id,
                count(*) AS failed_count, max(d.created_at) AS last_failure_at
         FROM ${this.t('webhook_deliveries')} d
         LEFT JOIN owner o ON o.tenant_id = d.tenant_id
         WHERE d.status = 'failed'
           AND d.created_at >= $1::timestamptz - interval '${WEBHOOK_WINDOW_HOURS} hours'
         GROUP BY d.tenant_id, o.auth_user_id
         ORDER BY count(*) DESC, d.tenant_id
         LIMIT ${LIST_LIMIT}`,
        [now],
      );
      const payments = await q<{
        tenant_id: string;
        user_id: string;
        source: 'intent' | 'subscription';
        status: string;
        at: Stamp;
      }>(
        `WITH ${owner}
         SELECT tenant_id, user_id, source, status, at FROM (
           SELECT p.tenant_id, COALESCE(o.auth_user_id, p.tenant_id) AS user_id,
                  'intent'::text AS source, p.status, p.created_at AS at
           FROM ${this.t('payment_intents')} p
           LEFT JOIN owner o ON o.tenant_id = p.tenant_id
           WHERE p.status IN ('rejected', 'mismatch')
             AND p.created_at >= $1::timestamptz - interval '${FAILED_PAYMENT_DAYS} days'
           UNION ALL
           SELECT b.tenant_id, COALESCE(o.auth_user_id, b.tenant_id) AS user_id,
                  'subscription'::text AS source, b.stripe_status AS status, b.updated_at AS at
           FROM ${this.t('tenant_billing')} b
           LEFT JOIN owner o ON o.tenant_id = b.tenant_id
           WHERE b.stripe_status IN ('past_due', 'unpaid')
         ) failed
         ORDER BY at DESC, tenant_id
         LIMIT ${LIST_LIMIT}`,
        [now],
      );
      return {
        staleInvoices: stale.map((r) => ({
          invoiceId: r.invoice_id,
          tenantId: r.tenant_id,
          userId: r.user_id,
          status: r.status,
          updatedAt: iso(r.updated_at),
        })),
        expiringCertificates: certificates.map((r) => ({
          companyId: r.company_id,
          tenantId: r.tenant_id,
          userId: r.user_id,
          taxId: r.tax_id,
          validUntil: iso(r.valid_until),
        })),
        failingWebhooks: webhooks.map((r) => ({
          tenantId: r.tenant_id,
          userId: r.user_id,
          failedCount24h: Number(r.failed_count),
          lastFailureAt: iso(r.last_failure_at),
        })),
        failedPayments: payments.map((r) => ({
          tenantId: r.tenant_id,
          userId: r.user_id,
          source: r.source,
          status: r.status,
          at: iso(r.at),
        })),
      };
    });
  }
}
