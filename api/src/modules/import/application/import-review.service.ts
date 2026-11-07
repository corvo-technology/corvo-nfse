import { BadRequestException, Injectable } from '@nestjs/common';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { InvoiceBatchService } from '@/modules/invoice/application/invoice-batch.service';
import {
  MAX_ROWS_PAGE,
  type ImportCounters,
  type ImportRecord,
  type ImportRow,
  type RowPage,
  type RowPageQuery,
} from '../domain/import';
import { ImportRepository } from '../domain/import.repository';
import { ImportNotFoundError, ImportStateError } from '../domain/import-error';
import { ImportFileStorage } from '../infra/import-file-storage';
import { rowKey } from './import-reader.service';
import { importAuthContext } from './system-auth-context';

export type ImportView = ImportRecord & { counters: ImportCounters };

const ERRORS_PAGE = 200;
const DISCARDABLE = new Set(['processing', 'ready', 'failed']);

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

    const data = { ...row.data, ...patch };
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
    await this.storage.remove(tenantId, env, id);
    await this.repo.delete(tenantId, id);
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
          const service = row.data.service as
            | { description?: unknown }
            | undefined;
          yield `${[row.line, row.errorCode, row.errorMessage, service?.description, row.data.amount].map(cell).join(';')}\n`;
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
  }
}

export const TEMPLATE_CSV =
  '﻿cnpj_prestador;tomador_documento;tomador_nome;tomador_email;descricao;valor;codigo_servico;data_competencia\n' +
  ';123.456.789-09;Maria da Silva;maria@exemplo.com.br;Consultoria mensal;1.500,00;;07/11/2026\n';
