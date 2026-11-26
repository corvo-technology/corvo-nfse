import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DOCUMENT_STORAGE,
  type DocumentFormat,
  type IDocumentStorage,
  type StorageRef,
} from '@/infra/storage/domain/document-storage';
import type { PackageScope } from '@/modules/invoice/domain/invoice-package.repository';
import type {
  PackageContribution,
  PackageContributor,
  PackageFile,
} from '@/modules/invoice/domain/package-contributor';
import { PackageContributorRegistry } from '@/modules/invoice/application/package/package-contributor.registry';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import {
  TypeormNfePackageQuery,
  type PackageNfe,
} from '../infra/typeorm-nfe-package.query';
import { DANFE_FILE, NFE_PROC_FILE } from './nfe-files';
import { buildNfeSummaryCsv } from './nfe-package-csv';

/** `nfe/{series}-{number}`: one folder per NF-e, with its own files and its events. */
function folderOf(row: PackageNfe): string {
  const number = String(row.number ?? 0).padStart(6, '0');
  return `nfe/${row.series ?? 0}-${number}`;
}

/**
 * Puts the NF-e of the month into the accountant package: for each authorized or cancelled NF-e,
 * the `nfeProc`, the DANFE and the XML of its events, plus `nfe-resumo.csv`. A month without NF-e
 * adds nothing, so the ZIP stays exactly as it was.
 */
@Injectable()
export class NfePackageContributor implements PackageContributor, OnModuleInit {
  private readonly logger = new Logger(NfePackageContributor.name);

  constructor(
    private readonly registry: PackageContributorRegistry,
    private readonly query: TypeormNfePackageQuery,
    private readonly events: TypeormNfeEvents,
    @Inject(DOCUMENT_STORAGE) private readonly storage: IDocumentStorage,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  summarize(
    scope: PackageScope,
  ): Promise<{ count: number; totalCents: number }> {
    return this.query.summarize(scope);
  }

  async collect(
    scope: PackageScope,
    limit: number,
  ): Promise<PackageContribution> {
    const rows = await this.query.list(scope, limit);
    if (rows.length === 0) return { entries: [], sheet: null };
    return {
      entries: rows.map((row) => ({
        read: (include: DocumentFormat[]) => this.read(row, include),
      })),
      sheet: {
        name: 'nfe-resumo.csv',
        content: Buffer.from(buildNfeSummaryCsv(rows), 'utf8'),
      },
    };
  }

  /** The files of one NF-e; one that cannot be read is left out (and logged), never the whole ZIP. */
  private async read(
    row: PackageNfe,
    include: DocumentFormat[],
  ): Promise<PackageFile[]> {
    if (!row.documentsReady) return [];
    const ref: StorageRef = {
      type: 'nfe',
      id: row.id,
      tenantId: row.tenantId,
      environment: row.environment,
    };
    const folder = folderOf(row);
    const files: PackageFile[] = [];
    const take = async (name: string, from: string) => {
      try {
        files.push({
          name: `${folder}/${name}`,
          content: await this.storage.getFile(ref, from),
        });
      } catch (error) {
        this.logger.warn({
          event: 'nfe_package_document_unavailable',
          documentId: row.id,
          file: from,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    if (include.includes('xml')) {
      await take(NFE_PROC_FILE, NFE_PROC_FILE);
      for (const event of await this.events.list(row.id, row.tenantId))
        if (event.xmlPath)
          await take(
            `events/${event.tpEvento}-${event.nSeq}.xml`,
            `events/${event.tpEvento}-${event.nSeq}.xml`,
          );
    }
    if (include.includes('pdf')) await take(DANFE_FILE, DANFE_FILE);
    return files;
  }
}
