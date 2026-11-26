import type { DocumentFormat } from '@/infra/storage/domain/document-storage';
import type { PackageScope } from './invoice-package.repository';

/** One file of the ZIP, with its path from the root of the archive. */
export interface PackageFile {
  name: string;
  content: Buffer;
}

/** A document (an NF-e) that adds files to the month package. */
export interface PackageContribution {
  /** Reads the files of each document, only the formats asked for; one at a time, to keep memory flat. */
  entries: Array<{ read(include: DocumentFormat[]): Promise<PackageFile[]> }>;
  /** The sheet that lists them (`nfe-resumo.csv`), written next to the files. `null` when there are none. */
  sheet: PackageFile | null;
}

/**
 * Another kind of fiscal document that goes into the month package. The NF-e module registers
 * itself here, so the package (which belongs to the invoice module) never imports it.
 */
export interface PackageContributor {
  /** How many documents the month has and their total, in cents (cancelled ones are not summed). */
  summarize(
    scope: PackageScope,
  ): Promise<{ count: number; totalCents: number }>;
  /** At most `limit` documents, in order. */
  collect(scope: PackageScope, limit: number): Promise<PackageContribution>;
}
