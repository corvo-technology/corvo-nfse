import { Injectable } from '@nestjs/common';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { CompanyService } from '@/modules/company/application/company.service';
import { InvoiceBatchService } from '@/modules/invoice/application/invoice-batch.service';
import { todayInSaoPaulo } from '@/modules/invoice-schedule/domain/recurrence';
import type { ImportRow } from '../domain/import';
import { ImportRepository } from '../domain/import.repository';
import { ImportError, type ImportErrorCode } from '../domain/import-error';
import { normalizeRow } from '../domain/normalize-row';
import { parseSpreadsheet, type ParsedRow } from '../domain/parse-spreadsheet';
import { ImportFileStorage } from '../infra/import-file-storage';
import { importAuthContext } from './system-auth-context';

const READ_CONCURRENCY = 5;
const SAVE_CHUNK = 100;

export type ImportRef = {
  tenantId: string;
  environment: ExecutionEnvironment;
  importId: string;
};

/** The idempotency key of one line: repeating an Emit can never issue the same line twice. */
export const rowKey = (importId: string, line: number) =>
  `import:${importId}:${line}`;

@Injectable()
export class ImportReaderService {
  constructor(
    private readonly repo: ImportRepository,
    private readonly storage: ImportFileStorage,
    private readonly batch: InvoiceBatchService,
    private readonly companies: CompanyService,
  ) {}

  /**
   * Reads the stored file and saves one row per line. A problem with the file fails the import
   * (and the file is deleted); anything unexpected is rethrown so the queue retries with the file kept.
   */
  async read(ref: ImportRef): Promise<void> {
    const { tenantId, environment, importId } = ref;
    const record = await this.repo.findById(tenantId, environment, importId);
    if (record?.status !== 'processing') return;
    try {
      const bytes = await this.storage.read(tenantId, environment, importId);
      const kind = /\.xlsx$/i.test(record.fileName) ? 'xlsx' : 'csv';
      const sheet = await parseSpreadsheet(bytes, kind);
      const company = record.companyId
        ? await this.findCompany(record.companyId, tenantId, environment)
        : null;
      const today = todayInSaoPaulo();
      await this.repo.deleteRows(tenantId, importId);
      await this.repo.updateStatus(tenantId, importId, {
        status: 'processing',
        rowsExpected: sheet.rows.length,
        unknownColumns: sheet.unknownColumns,
      });
      // Saved chunk by chunk, so the screen can show the reading advance instead of a long wait.
      for (let at = 0; at < sheet.rows.length; at += SAVE_CHUNK) {
        const rows = await mapPool(
          sheet.rows.slice(at, at + SAVE_CHUNK),
          READ_CONCURRENCY,
          (row) => this.buildRow(ref, row, today, company),
        );
        await this.repo.insertRows(tenantId, importId, rows);
      }
      await this.repo.updateStatus(tenantId, importId, { status: 'ready' });
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      await this.markFailed(ref, error.code);
      return;
    }
    await this.storage.remove(tenantId, environment, importId);
  }

  /** A company deleted between the upload and the reading is a problem of this import, not a reason to retry. */
  private async findCompany(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ) {
    try {
      return await this.companies.findById(id, tenantId, environment);
    } catch (error) {
      if (error instanceof Error && error.name === 'CompanyNotFoundError')
        throw new ImportError(
          'ERROR_IMPORT_COMPANY_NOT_FOUND',
          'The company chosen for this import no longer exists',
        );
      throw error;
    }
  }

  async markFailed(ref: ImportRef, errorCode: ImportErrorCode): Promise<void> {
    await this.repo.updateStatus(ref.tenantId, ref.importId, {
      status: 'failed',
      errorCode,
    });
    await this.storage.remove(ref.tenantId, ref.environment, ref.importId);
  }

  private async buildRow(
    ref: ImportRef,
    parsed: ParsedRow,
    today: string,
    company: { id: string; taxId: string } | null,
  ): Promise<ImportRow> {
    const { item, cnpjPrestador } = normalizeRow(parsed.cells, today);
    const invalid = (errorCode: string, errorMessage: string): ImportRow => ({
      line: parsed.line,
      data: item,
      status: 'invalid',
      errorCode,
      errorMessage,
      invoiceId: null,
    });
    if (cnpjPrestador && company && cnpjPrestador !== company.taxId)
      return invalid(
        'ERROR_IMPORT_COMPANY_MISMATCH',
        'The CNPJ in this row is not the company chosen for the import',
      );
    if (cnpjPrestador) item.companyTaxId = cnpjPrestador;
    else if (company) item.companyId = company.id;
    else
      return invalid(
        'ERROR_IMPORT_COMPANY_REQUIRED',
        'This row has no company: fill the CNPJ column or choose a company',
      );

    const checked = await this.batch.checkItem(
      { ...item, idempotencyKey: rowKey(ref.importId, parsed.line) },
      ref.tenantId,
      importAuthContext(ref.tenantId, ref.environment),
    );
    return checked.ok
      ? {
          line: parsed.line,
          data: item,
          status: 'valid',
          errorCode: null,
          errorMessage: null,
          invoiceId: null,
        }
      : invalid(checked.error.code, checked.error.message);
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}
