import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import archiver from 'archiver';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  DOCUMENT_STORAGE,
  type DocumentFormat,
  type IDocumentStorage,
} from '@/infra/storage/domain/document-storage';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { Decimal } from '@/shared/types/money';
import type { PackageContribution } from '../../domain/package-contributor';
import { PackageContributorRegistry } from './package-contributor.registry';
import {
  IInvoicePackageRepository,
  monthRange,
  type PackageInvoice,
  type PackageScope,
} from '../../domain/invoice-package.repository';
import { buildSummaryCsv, type PackageSummaryRow } from './package-summary-csv';

/** Notes per package. Above it the request is refused, not cut. */
export const PACKAGE_MAX_INVOICES = 500;
/** Documents read from storage at the same time while the ZIP is written in order. */
const READ_CONCURRENCY = 16;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type PackageInclude = DocumentFormat[];

export interface PackageSummary {
  month: string;
  /** Authorized and cancelled notes of the month. */
  count: number;
  /** Sum of the gross amount of the authorized (not cancelled) notes, "1234.50". */
  total: string;
  limit: number;
  companyName: string;
  companyTaxId: string;
}

export function parseMonth(month: unknown): { start: string; end: string } {
  const match = typeof month === 'string' ? MONTH.exec(month) : null;
  if (!match)
    throw new BadRequestException({
      code: 'PACKAGE_MONTH_INVALID',
      message: 'month must be YYYY-MM',
    });
  return monthRange(`${match[1]}-${match[2]}`);
}

export function parseInclude(value: unknown): PackageInclude {
  if (value === undefined || value === '') return ['xml', 'pdf'];
  const parts = (typeof value === 'string' ? value : '')
    .split(',')
    .map((part) => part.trim());
  const valid = parts.every((part) => part === 'xml' || part === 'pdf');
  if (!valid || parts.length === 0)
    throw new BadRequestException({
      code: 'PACKAGE_INCLUDE_INVALID',
      message: 'include must be xml, pdf or xml,pdf',
    });
  return [...new Set(parts)] as PackageInclude;
}

function fileBase(row: PackageInvoice): string {
  const number = row.summary.number;
  const name = number ? number.padStart(6, '0') : row.id;
  return row.summary.cancelled ? `cancelada-${name}` : name;
}

/**
 * The month package: XML and PDF of every authorized or cancelled note, plus resumo.csv. When the
 * month also has NF-e, they go in the `nfe/` folder with their own `nfe-resumo.csv` (added by the
 * NF-e module through the contributor registry); without NF-e the ZIP is exactly the same.
 */
@Injectable()
export class InvoicePackageService {
  private readonly logger = new Logger(InvoicePackageService.name);

  constructor(
    private readonly invoices: IInvoicePackageRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: IDocumentStorage,
    private readonly companies: ICompanyRepository,
    @Optional() private readonly contributors?: PackageContributorRegistry,
  ) {}

  private async company(scope: PackageScope) {
    const company = await this.companies.findByIdAndTenantId(
      scope.companyId,
      scope.tenantId,
      scope.environment,
    );
    if (!company)
      throw new NotFoundException({
        code: 'COMPANY_NOT_FOUND',
        message: 'Company not found',
      });
    return company;
  }

  async summary(scope: PackageScope): Promise<PackageSummary> {
    return runWithTenant(scope.tenantId, async () => {
      const company = await this.company(scope);
      const { count, total } = await this.invoices.summarize(scope);
      let extraCount = 0;
      let extraCents = 0;
      for (const contributor of this.contributors?.all() ?? []) {
        const extra = await contributor.summarize(scope);
        extraCount += extra.count;
        extraCents += extra.totalCents;
      }
      return {
        month: scope.month,
        count: count + extraCount,
        total:
          extraCents === 0
            ? total
            : new Decimal(total)
                .plus(new Decimal(extraCents).div(100))
                .toFixed(2),
        limit: PACKAGE_MAX_INVOICES,
        companyName: company.tradeName ?? company.legalName,
        companyTaxId: company.taxId,
      };
    });
  }

  private async load(scope: PackageScope): Promise<PackageInvoice[]> {
    const rows = await this.invoices.list(scope, PACKAGE_MAX_INVOICES + 1);
    if (rows.length > PACKAGE_MAX_INVOICES) {
      const { count } = await this.invoices.summarize(scope);
      throw new UnprocessableEntityException({
        code: 'PACKAGE_TOO_LARGE',
        message: `This month has ${count} notes; the package holds at most ${PACKAGE_MAX_INVOICES}`,
        count,
        limit: PACKAGE_MAX_INVOICES,
      });
    }
    return rows;
  }

  /** The other documents of the month (NF-e), refused the same way when they do not fit. */
  private async loadExtras(
    scope: PackageScope,
  ): Promise<PackageContribution[]> {
    const found: PackageContribution[] = [];
    for (const contributor of this.contributors?.all() ?? []) {
      const contribution = await contributor.collect(
        scope,
        PACKAGE_MAX_INVOICES + 1,
      );
      if (contribution.entries.length > PACKAGE_MAX_INVOICES) {
        const { count } = await contributor.summarize(scope);
        throw new UnprocessableEntityException({
          code: 'PACKAGE_TOO_LARGE',
          message: `This month has ${count} notes; the package holds at most ${PACKAGE_MAX_INVOICES}`,
          count,
          limit: PACKAGE_MAX_INVOICES,
        });
      }
      found.push(contribution);
    }
    return found;
  }

  /**
   * Validates the request and returns the ZIP as a stream. The month is read up front, so
   * "too large" and "empty" are answered before any byte of the ZIP is sent.
   */
  async open(
    scope: PackageScope,
    include: PackageInclude,
  ): Promise<{ fileName: string; stream: Readable; count: number }> {
    const { rows, company, extras } = await runWithTenant(
      scope.tenantId,
      async () => ({
        company: await this.company(scope),
        rows: await this.load(scope),
        extras: await this.loadExtras(scope),
      }),
    );
    const extraCount = extras.reduce((sum, e) => sum + e.entries.length, 0);
    if (rows.length === 0 && extraCount === 0)
      throw new NotFoundException({
        code: 'PACKAGE_EMPTY',
        message: 'No authorized or cancelled notes in this month',
      });
    const archive = archiver('zip', { zlib: { level: 6 } });
    void this.fill(archive, scope, rows, include, extras).catch(
      (error: unknown) => {
        this.logger.error({
          event: 'invoice_package_failed',
          tenantId: scope.tenantId,
          companyId: scope.companyId,
          error: error instanceof Error ? error.message : String(error),
        });
        // The client sees a cut ZIP without resumo.csv: that is how an incomplete package shows.
        archive.destroy(error instanceof Error ? error : new Error('failed'));
      },
    );
    return {
      fileName: `nfse-${scope.month}-${company.taxId}.zip`,
      stream: archive,
      count: rows.length + extraCount,
    };
  }

  private async read(
    row: PackageInvoice,
    format: DocumentFormat,
  ): Promise<Buffer | null> {
    const invoice = row;
    const environment =
      row.documentKeyVersion === 1 ? undefined : row.environment;
    try {
      return format === 'xml'
        ? Buffer.from(
            await this.storage.getXml(
              invoice.tenantId,
              invoice.id,
              environment,
            ),
            'utf8',
          )
        : await this.storage.getPdf(invoice.tenantId, invoice.id, environment);
    } catch (error) {
      this.logger.warn({
        event: 'invoice_package_document_unavailable',
        invoiceId: invoice.id,
        format,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async add(
    archive: archiver.Archiver,
    name: string,
    content: Buffer,
  ): Promise<void> {
    const written = once(archive, 'entry');
    // PDFs are already compressed: storing them saves CPU, which is most of the time spent.
    archive.append(content, { name, store: name.endsWith('.pdf') });
    // Waiting for each entry keeps memory flat when the client downloads slowly.
    await written;
  }

  /** The files of the other documents, one at a time, then their own sheet. */
  private async fillExtra(
    archive: archiver.Archiver,
    extra: PackageContribution,
    include: PackageInclude,
  ): Promise<void> {
    for (const entry of extra.entries)
      for (const file of await entry.read(include))
        await this.add(archive, file.name, file.content);
    if (extra.sheet)
      await this.add(archive, extra.sheet.name, extra.sheet.content);
  }

  private async fill(
    archive: archiver.Archiver,
    scope: PackageScope,
    rows: PackageInvoice[],
    include: PackageInclude,
    extras: PackageContribution[] = [],
  ): Promise<void> {
    await runWithTenant(scope.tenantId, async () => {
      const summary: PackageSummaryRow[] = [];
      const used = new Set<string>();
      for (let i = 0; i < rows.length; i += READ_CONCURRENCY) {
        const chunk = rows.slice(i, i + READ_CONCURRENCY);
        const documents = await Promise.all(
          chunk.map((row) =>
            row.documentsReady
              ? Promise.all(include.map((format) => this.read(row, format)))
              : Promise.resolve(null),
          ),
        );
        for (const [index, row] of chunk.entries()) {
          const buffers = documents[index];
          let status: PackageSummaryRow['documents'] = 'pendente';
          if (buffers) {
            status = buffers.every(Boolean) ? 'ok' : 'indisponível';
            let base = fileBase(row);
            if (used.has(base)) base = `${base}-${row.id.slice(0, 8)}`;
            used.add(base);
            for (const [at, format] of include.entries()) {
              const content = buffers[at];
              if (content)
                await this.add(archive, `${format}/${base}.${format}`, content);
            }
          }
          summary.push({ ...row.summary, documents: status });
        }
      }
      for (const extra of extras) await this.fillExtra(archive, extra, include);
      // Last on purpose: a ZIP without resumo.csv is an incomplete ZIP.
      await this.add(
        archive,
        'resumo.csv',
        Buffer.from(buildSummaryCsv(summary), 'utf8'),
      );
      await archive.finalize();
    });
  }
}
