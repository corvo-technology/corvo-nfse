import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  PlatformOverview,
  Rev,
  Win,
  Windows,
} from '../../platform-admin.contract';
import { PlatformReadSession } from '../platform-read-session';

const DAY_MS = 86_400_000;
const BRT_OFFSET_MS = 3 * 3_600_000; // UTC-3 fixed (no DST)

export function rejectionRate(
  authorized: number,
  rejected: number,
): number | null {
  const total = authorized + rejected;
  return total === 0 ? null : rejected / total;
}

/** Start (UTC instant) of the current America/Sao_Paulo day (UTC-3 fixed). */
export function saoPauloDayStart(now: Date): Date {
  const shifted = now.getTime() - BRT_OFFSET_MS;
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(dayStart + BRT_OFFSET_MS);
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);

function win(authorized: number, rejected: number): Win {
  return {
    authorized,
    rejected,
    rejectionRate: rejectionRate(authorized, rejected),
  };
}

function rev(subscriptionCents: number, avulsoCents: number): Rev {
  return {
    subscriptionCents,
    avulsoCents,
    totalCents: subscriptionCents + avulsoCents,
  };
}

@Injectable()
export class PlatformOverviewReadRepository {
  constructor(
    private readonly session: PlatformReadSession,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Raw SQL has no search_path on pooled connections: qualify with the schema. */
  private t(name: string): string {
    const options = this.dataSource.options as { schema?: string };
    const schema = (options.schema ?? 'corvo').replaceAll('"', '""');
    return `"${schema}".${name}`;
  }

  async snapshot(now: Date): Promise<PlatformOverview> {
    const today = saoPauloDayStart(now);
    const d7 = new Date(now.getTime() - 7 * DAY_MS);
    const d30 = new Date(now.getTime() - 30 * DAY_MS);

    return this.session.run(async (q) => {
      const [users] = await q<Row>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE created_at >= $1) AS "new7d",
                count(*) FILTER (WHERE created_at >= $2) AS "new30d"
           FROM ${this.t('auth_users')}`,
        [d7, d30],
      );
      const invoiceRows = await q<Row>(
        `SELECT environment,
                count(*) FILTER (WHERE authorized_at >= $1) AS auth_today,
                count(*) FILTER (WHERE status = 'rejected' AND updated_at >= $1) AS rej_today,
                count(*) FILTER (WHERE authorized_at >= $2) AS auth_d7,
                count(*) FILTER (WHERE status = 'rejected' AND updated_at >= $2) AS rej_d7,
                count(*) FILTER (WHERE authorized_at >= $3) AS auth_d30,
                count(*) FILTER (WHERE status = 'rejected' AND updated_at >= $3) AS rej_d30
           FROM ${this.t('nfse_invoices')}
          WHERE environment IN ('live', 'test')
            AND (authorized_at >= $3 OR (status = 'rejected' AND updated_at >= $3))
          GROUP BY environment`,
        [today, d7, d30],
      );
      const [revenue] = await q<Row>(
        `SELECT
           coalesce(sum(amount_cents) FILTER (WHERE kind = 'plan' AND paid_at >= $1), 0) AS sub_d7,
           coalesce(sum(amount_cents) FILTER (WHERE kind = 'avulso' AND paid_at >= $1), 0) AS avulso_d7,
           coalesce(sum(amount_cents) FILTER (WHERE kind = 'plan' AND paid_at >= $2), 0) AS sub_d30,
           coalesce(sum(amount_cents) FILTER (WHERE kind = 'avulso' AND paid_at >= $2), 0) AS avulso_d30,
           (SELECT min(paid_at) FROM ${this.t('payment_intents')}
             WHERE provider = 'stripe' AND kind = 'plan' AND cycle = 'monthly'
               AND idempotency_key IS NULL) AS stripe_since
           FROM ${this.t('payment_intents')}
          WHERE status = 'paid' AND paid_at >= $2`,
        [d7, d30],
      );
      const [grants] = await q<Row>(
        `SELECT
           coalesce(sum((payload->>'amount')::int) FILTER (WHERE created_at >= $1), 0) AS "units7d",
           coalesce(sum((payload->>'amount')::int) FILTER (WHERE created_at >= $2), 0) AS "units30d"
           FROM ${this.t('platform_admin_audit_events')}
          WHERE action = 'credit_grant' AND success AND created_at >= $2`,
        [d7, d30],
      );

      const windowsFor = (environment: string): Windows => {
        const r = invoiceRows.find((x) => x.environment === environment);
        return {
          today: win(num(r?.auth_today), num(r?.rej_today)),
          d7: win(num(r?.auth_d7), num(r?.rej_d7)),
          d30: win(num(r?.auth_d30), num(r?.rej_d30)),
        };
      };
      const since = revenue?.stripe_since;
      return {
        users: {
          total: num(users?.total),
          new7d: num(users?.new7d),
          new30d: num(users?.new30d),
        },
        invoices: { live: windowsFor('live'), test: windowsFor('test') },
        revenue: {
          d7: rev(num(revenue?.sub_d7), num(revenue?.avulso_d7)),
          d30: rev(num(revenue?.sub_d30), num(revenue?.avulso_d30)),
          stripeRecordedSince: since
            ? new Date(since as string | Date).toISOString()
            : null,
        },
        adminGrants: {
          units7d: num(grants?.units7d),
          units30d: num(grants?.units30d),
        },
      };
    });
  }
}
