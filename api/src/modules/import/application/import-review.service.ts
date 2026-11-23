import { BadRequestException, Injectable } from '@nestjs/common';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { InvoiceBatchService } from '@/modules/invoice/application/invoice-batch.service';
import {
  LIMIT_CODES,
  MAX_ROWS_PAGE,
  type ImportCounters,
  type ImportRecord,
  type ImportRow,
  type ImportStatus,
  type RowPage,
  type RowPageQuery,
} from '../domain/import';
import { ImportRepository } from '../domain/import.repository';
import { ImportNotFoundError, ImportStateError } from '../domain/import-error';
import { ImportFileStorage } from '../infra/import-file-storage';
import { rowKey } from './import-reader.service';
import { importAuthContext } from './system-auth-context';

const NESTED_FIELDS = ['customer', 'service'] as const;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The patch wins field by field, also inside customer and service, so editing the e-mail keeps the name. */
function mergePatch(
  stored: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const data = { ...stored, ...patch };
  for (const key of NESTED_FIELDS)
    if (isObject(stored[key]) && isObject(patch[key]))
      data[key] = { ...stored[key], ...patch[key] };
  return data;
}

export type ImportView = ImportRecord & { counters: ImportCounters };

const ERRORS_PAGE = 200;
export const MAX_RECENT_IMPORTS = 20;
const EMPTY_COUNTERS: ImportCounters = {
  total: 0,
  valid: 0,
  invalid: 0,
  accepted: 0,
  authorized: 0,
  awaitingCredits: 0,
  validAmount: 0,
  awaitingAmount: 0,
  failed: 0,
  pending: 0,
  authorizedAmount: 0,
  pendingAmount: 0,
  failedAmount: 0,
};
const DISCARDABLE = new Set<ImportStatus>(['processing', 'ready', 'failed']);

/** A cell for Excel in Brazil: ; separated, quoted when it holds ; " or a line break. */
const cell = (value: unknown): string => {
  let text =
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  // A text starting with = + - @ would run as a formula when the file is opened in Excel.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

@Injectable()
export class ImportReviewService {
  constructor(
    private readonly repo: ImportRepository,
    private readonly storage: ImportFileStorage,
    private readonly batch: InvoiceBatchService,
  ) {}

  private async owned(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<ImportRecord> {
    const record = await this.repo.findById(tenantId, env, id);
    if (!record) throw new ImportNotFoundError();
    return record;
  }

  async assertOwned(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<void> {
    await this.owned(tenantId, env, id);
  }

  /** The newest imports with their counters, so the user can pick one up again later. */
  async list(
    tenantId: string,
    env: ExecutionEnvironment,
    limit: number,
  ): Promise<ImportView[]> {
    if (limit < 1 || limit > MAX_RECENT_IMPORTS)
      throw new BadRequestException(
        `limit must be between 1 and ${MAX_RECENT_IMPORTS}`,
      );
    const records = await this.repo.listRecent(tenantId, env, limit);
    const counters = await this.repo.countersMany(
      tenantId,
      env,
      records.map((record) => record.id),
    );
    return records.map((record) => ({
      ...record,
      counters: counters.get(record.id) ?? EMPTY_COUNTERS,
    }));
  }

  async get(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<ImportView> {
    const record = await this.owned(tenantId, env, id);
    const counters = await this.repo.counters(tenantId, env, id);
    // The import is done when nothing is waiting or still being processed. Closed here, on read,
    // because the city answers (and invoices turn final) long after the last chunk was sent.
    if (record.status === 'emitting' && counters.pending === 0) {
      const finished = new Date();
      await this.repo.updateStatus(tenantId, id, {
        status: 'done',
        emitFinishedAt: finished,
      });
      return { ...record, status: 'done', emitFinishedAt: finished, counters };
    }
    return { ...record, counters };
  }

  async listRows(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
    query: RowPageQuery,
  ): Promise<RowPage> {
    if (query.limit < 1 || query.limit > MAX_ROWS_PAGE)
      throw new BadRequestException(
        `limit must be between 1 and ${MAX_ROWS_PAGE}`,
      );
    await this.owned(tenantId, env, id);
    return this.repo.listRows(tenantId, env, id, query);
  }

  /** Changes some fields of one row and checks it again, exactly as reading did. */
  async updateRow(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
    line: number,
    patch: Record<string, unknown>,
  ): Promise<ImportRow> {
    const record = await this.owned(tenantId, env, id);
    if (record.status !== 'ready') throw new ImportStateError();
    const row = await this.repo.findRow(tenantId, env, id, line);
    if (!row) throw new ImportNotFoundError();
    if (row.status !== 'valid' && row.status !== 'invalid')
      throw new ImportStateError();

    if ('companyId' in patch || 'companyTaxId' in patch)
      throw new BadRequestException(
        'companyId and companyTaxId cannot be changed: the company of a row is set by the spreadsheet or the import',
      );
    const data = mergePatch(row.data, patch);
    const checked = await this.batch.checkItem(
      { ...data, idempotencyKey: rowKey(id, line) },
      tenantId,
      importAuthContext(tenantId, env),
    );
    const next = checked.ok
      ? { data, status: 'valid' as const, errorCode: null, errorMessage: null }
      : {
          data,
          status: 'invalid' as const,
          errorCode: checked.error.code,
          errorMessage: checked.error.message,
        };
    // Conditional in SQL: an Emit that queued this row after we read it wins, and the edit is refused.
    if (!(await this.repo.updateEditableRow(tenantId, id, line, next)))
      throw new ImportStateError();
    return { ...row, ...next };
  }

  async discard(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): Promise<void> {
    const record = await this.owned(tenantId, env, id);
    if (!DISCARDABLE.has(record.status)) throw new ImportStateError();
    // Conditional: an Emit that claimed the import first wins, and the file is kept for it.
    if (!(await this.repo.deleteIfStatus(tenantId, id, [...DISCARDABLE])))
      throw new ImportStateError();
    await this.storage.remove(tenantId, env, id);
  }

  /** Rows that need attention, one page at a time, so a large import never sits in memory. */
  async *errorsCsv(
    tenantId: string,
    env: ExecutionEnvironment,
    id: string,
  ): AsyncGenerator<string> {
    await this.owned(tenantId, env, id);
    yield '﻿linha;codigo;mensagem;descricao;valor\n';
    for (const status of ['invalid', 'rejected'] as const) {
      let cursor: string | undefined;
      do {
        const page = await this.repo.listRows(tenantId, env, id, {
          status,
          limit: ERRORS_PAGE,
          cursor,
        });
        for (const row of page.items) {
          // Waiting for credits is not an error: those rows are emitted again after a top-up.
          if (
            status === 'rejected' &&
            row.errorCode &&
            LIMIT_CODES.includes(row.errorCode)
          )
            continue;
          yield errorLine(row);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    // Rows that were accepted and then refused by the city: the error lives on the invoice.
    let cursor: string | undefined;
    do {
      const page = await this.repo.listFailedInvoices(tenantId, env, id, {
        limit: ERRORS_PAGE,
        cursor,
      });
      for (const row of page.items) yield errorLine(row);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
}

function errorLine(row: ImportRow): string {
  const service = row.data.service as { description?: unknown } | undefined;
  return `${[row.line, row.errorCode, row.errorMessage, service?.description, row.data.amount].map(cell).join(';')}\n`;
}

export const TEMPLATE_CSV =
  '﻿cnpj_prestador;tomador_documento;tomador_nome;tomador_email;descricao;valor;codigo_servico;data_competencia;pedido;observacoes\n' +
  ';123.456.789-09;Maria da Silva;maria@exemplo.com.br;Consultoria mensal;1.500,00;;07/11/2026;PO-4521;Parcela 2 de 3\n';
