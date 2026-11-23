import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CursorPage,
  encodeCursor,
  invalidCursor,
  normalizeLimit,
} from '@/shared/http/pagination';
import { cursorScope, readKeysetCursor } from '@/shared/http/keyset-pagination';
import type { PlatformUserRow } from '../../platform-admin.contract';
import { PlatformReadSession } from '../platform-read-session';

const MAX_PAGE = 50;
const MIN_CNPJ_DIGITS = 4;
const SORT_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const SORT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Escapes LIKE wildcards so the term is matched literally (ESCAPE '\'). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Digits only, so a masked CNPJ matches the stored tax id. */
export function searchDigits(term: string): string {
  return term.replace(/\D/g, '');
}

export type PlatformUsersListQuery = {
  search?: string;
  limit?: number;
  cursor?: string;
};

type PageRow = { id: string; sort_key: string };
type DerivedRow = {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  plan_slug: string | null;
  live_invoices: string | number;
  avulso_balance: string | number;
  companies_count: string | number;
  last_activity_at: Date | null;
};

@Injectable()
export class PlatformUsersReadRepository {
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

  async list(
    query: PlatformUsersListQuery,
  ): Promise<CursorPage<PlatformUserRow>> {
    const limit = Math.min(normalizeLimit(query.limit), MAX_PAGE);
    const search = query.search?.trim() || undefined;
    const cursor = readKeysetCursor(query.cursor, [
      'platform-users',
      search ?? null,
    ]);
    if (
      cursor &&
      (typeof cursor.sort !== 'string' || !SORT_PATTERN.test(cursor.sort))
    )
      return invalidCursor();

    return this.session.run(async (q) => {
      const params: unknown[] = [];
      const bind = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };
      const where: string[] = [];
      if (search) {
        const like = bind(escapeLike(search));
        const digits = searchDigits(search);
        const parts = [
          `u.email ILIKE '%' || ${like} || '%' ESCAPE '\\'`,
          `u.name ILIKE '%' || ${like} || '%' ESCAPE '\\'`,
        ];
        if (digits.length >= MIN_CNPJ_DIGITS)
          parts.push(
            `EXISTS (SELECT 1 FROM ${this.t('tenant_memberships')} m JOIN ${this.t('nfse_companies')} c ON c.tenant_id = m.tenant_id
               WHERE m.auth_user_id = u.id AND c.deleted_at IS NULL
                 AND regexp_replace(c.tax_id, '\\D', '', 'g') LIKE ${bind(digits)} || '%')`,
          );
        where.push(`(${parts.join(' OR ')})`);
      }
      if (cursor)
        where.push(
          `(u.created_at, u.id) < (${bind(cursor.sort)}::timestamptz, ${bind(cursor.id)}::uuid)`,
        );
      const pageRows = await q<PageRow>(
        `SELECT u.id, to_char(u.created_at AT TIME ZONE 'UTC', ${SORT_FORMAT}) AS sort_key
           FROM ${this.t('auth_users')} u
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY u.created_at DESC, u.id DESC
          LIMIT ${bind(limit + 1)}`,
        params,
      );
      const hasMore = pageRows.length > limit;
      const page = pageRows.slice(0, limit);
      if (!page.length)
        return new CursorPage<PlatformUserRow>([], {
          limit,
          hasMore: false,
          nextCursor: null,
        });

      const derived = await q<DerivedRow>(
        derivedSql((n) => this.t(n)),
        [page.map((r) => r.id)],
      );
      const byId = new Map(derived.map((r) => [r.id, r]));
      const data = page.flatMap((row) => {
        const d = byId.get(row.id);
        return d ? [present(d)] : [];
      });
      const last = page[page.length - 1];
      return new CursorPage(data, {
        limit,
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({
              v: 1,
              scope: cursorScope(['platform-users', search ?? null]),
              sort: last.sort_key,
              id: last.id,
            })
          : null,
      });
    });
  }
}

function present(d: DerivedRow): PlatformUserRow {
  return {
    id: d.id,
    email: d.email,
    name: d.name,
    createdAt: new Date(d.created_at).toISOString(),
    planSlug: d.plan_slug,
    liveInvoicesThisMonth: Number(d.live_invoices),
    avulsoBalance: Number(d.avulso_balance),
    companiesCount: Number(d.companies_count),
    lastActivityAt: d.last_activity_at
      ? new Date(d.last_activity_at).toISOString()
      : null,
  };
}

// Workspace of a row: the user's own tenant (tenant id = user id); otherwise the
// workspace where the user is the oldest admin. Only runs for the ids of the page.
const derivedSql = (t: (name: string) => string) => `
SELECT u.id, u.email, u.name, u.created_at,
       p.slug AS plan_slug,
       COALESCE(inv.live_count, 0) AS live_invoices,
       COALESCE(bal.balance, 0) AS avulso_balance,
       COALESCE(co.n, 0) AS companies_count,
       GREATEST(inv.last_at, k.last_at, mc.last_at, u.last_login_at) AS last_activity_at
  FROM ${t('auth_users')} u
  LEFT JOIN LATERAL (
    SELECT c.tid FROM (
      SELECT t.id AS tid, 0 AS pri, t.created_at AS ord FROM ${t('tenants')} t WHERE t.id = u.id
      UNION ALL
      SELECT m.tenant_id, 1, m.created_at FROM ${t('tenant_memberships')} m
       WHERE m.auth_user_id = u.id AND m.role = 'admin' AND m.is_active
    ) c ORDER BY c.pri, c.ord, c.tid LIMIT 1
  ) w ON true
  LEFT JOIN ${t('tenants')} tn ON tn.id = w.tid
  LEFT JOIN ${t('plans')} p ON p.id = tn.plan_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (
             WHERE i.environment = 'live' AND i.status = 'authorized'
               AND i.authorized_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
           ) AS live_count,
           max(i.created_at) AS last_at
      FROM ${t('nfse_invoices')} i WHERE i.tenant_id = w.tid
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT sum(ct.amount) AS balance FROM ${t('credit_transactions')} ct WHERE ct.tenant_id = w.tid AND ct.source IN ('avulso', 'bonus')
  ) bal ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM ${t('nfse_companies')} c WHERE c.tenant_id = w.tid AND c.deleted_at IS NULL
  ) co ON true
  LEFT JOIN LATERAL (
    SELECT max(a.last_used_at) AS last_at FROM ${t('api_keys')} a WHERE a.tenant_id = w.tid
  ) k ON true
  LEFT JOIN LATERAL (
    SELECT max(m.last_used_at) AS last_at FROM ${t('mcp_connections')} m WHERE m.tenant_id = w.tid
  ) mc ON true
 WHERE u.id = ANY($1::uuid[])`;
