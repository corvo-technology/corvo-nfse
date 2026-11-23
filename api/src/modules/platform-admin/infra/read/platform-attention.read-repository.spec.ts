import type { DataSource } from 'typeorm';
import type {
  PlatformQuery,
  PlatformReadSession,
} from '../platform-read-session';
import {
  CERTIFICATE_DAYS,
  PlatformAttentionReadRepository,
  STALE_INVOICE_MINUTES,
  WEBHOOK_WINDOW_HOURS,
} from './platform-attention.read-repository';

const now = new Date('2026-11-23T12:00:00.000Z');
const dataSource = { options: { schema: 'corvo' } } as unknown as DataSource;

function build(rowsBySql: Record<string, unknown[]>) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const q: PlatformQuery = <R>(
    sql: string,
    params: readonly unknown[] = [],
  ) => {
    calls.push({ sql, params });
    const key = Object.keys(rowsBySql).find((k) => sql.includes(k));
    return Promise.resolve((key ? rowsBySql[key] : []) as R[]);
  };
  const session = {
    run: <T>(work: (q: PlatformQuery) => Promise<T>) => work(q),
  } as unknown as PlatformReadSession;
  return {
    repo: new PlatformAttentionReadRepository(session, dataSource),
    calls,
  };
}

describe('PlatformAttentionReadRepository', () => {
  it('constantes batem com a spec', () =>
    expect([
      STALE_INVOICE_MINUTES,
      CERTIFICATE_DAYS,
      WEBHOOK_WINDOW_HOURS,
    ]).toEqual([60, 15, 24]));

  it('mapeia as linhas para o contrato (datas ISO, contagem numérica)', async () => {
    const at = new Date('2026-11-23T10:00:00.000Z');
    const { repo, calls } = build({
      'FROM "corvo"."nfse_invoices"': [
        {
          invoice_id: 'i1',
          tenant_id: 't1',
          user_id: 'u1',
          status: 'retry_pending',
          updated_at: at,
        },
      ],
      'FROM "corvo"."nfse_certificates"': [
        {
          company_id: 'c1',
          tenant_id: 't1',
          user_id: 'u1',
          tax_id: '123',
          valid_until: at,
        },
      ],
      'FROM "corvo"."webhook_deliveries"': [
        {
          tenant_id: 't1',
          user_id: 'u1',
          failed_count: '3',
          last_failure_at: at,
        },
      ],
      'FROM "corvo"."payment_intents"': [
        {
          tenant_id: 't1',
          user_id: 'u1',
          source: 'intent',
          status: 'rejected',
          at,
        },
        {
          tenant_id: 't2',
          user_id: 't2',
          source: 'subscription',
          status: 'past_due',
          at,
        },
      ],
    });
    const result = await repo.snapshot(now);
    expect(result.staleInvoices).toEqual([
      {
        invoiceId: 'i1',
        tenantId: 't1',
        userId: 'u1',
        status: 'retry_pending',
        updatedAt: at.toISOString(),
      },
    ]);
    expect(result.expiringCertificates[0]).toEqual({
      companyId: 'c1',
      tenantId: 't1',
      userId: 'u1',
      taxId: '123',
      validUntil: at.toISOString(),
    });
    expect(result.failingWebhooks[0]).toEqual({
      tenantId: 't1',
      userId: 'u1',
      failedCount24h: 3,
      lastFailureAt: at.toISOString(),
    });
    expect(result.failedPayments.map((p) => p.source)).toEqual([
      'intent',
      'subscription',
    ]);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.every((c) => c.params[0] === now)).toBe(true);
  });
});
