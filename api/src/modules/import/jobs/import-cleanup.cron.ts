import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ImportReaderService } from '../application/import-reader.service';
import { ImportRepository } from '../domain/import.repository';
import { ImportFileStorage } from '../infra/import-file-storage';

/** A file that is still stored after this long lost its reading job. */
const ORPHAN_FILE_HOURS = 24;
/** Imports and their rows are kept for a month. */
const KEEP_DAYS = 30;

@Injectable()
export class ImportCleanupCron {
  private readonly logger = new Logger(ImportCleanupCron.name);

  constructor(
    private readonly storage: ImportFileStorage,
    private readonly repo: ImportRepository,
    private readonly reader: ImportReaderService,
  ) {}

  @Cron('30 3 * * *', {
    name: 'import-cleanup',
    timeZone: 'America/Sao_Paulo',
    waitForCompletion: true,
  })
  async run(): Promise<void> {
    let orphans = 0;
    try {
      for (const ref of await this.storage.listOlderThan(ORPHAN_FILE_HOURS)) {
        try {
          const record = await this.repo.findById(
            ref.tenantId,
            ref.environment,
            ref.importId,
          );
          if (record?.status === 'processing')
            await this.reader.markFailed(ref, 'ERROR_IMPORT_UNREADABLE');
          else
            await this.storage.remove(
              ref.tenantId,
              ref.environment,
              ref.importId,
            );
          orphans++;
        } catch (error) {
          this.logger.warn({
            event: 'import_orphan_cleanup_failed',
            importId: ref.importId,
            error: String(error),
          });
        }
      }
      // An import left processing with no file at all (a crash between saving it and uploading) has no key to find above.
      const stuck = await this.repo.failStuck(ORPHAN_FILE_HOURS);
      const dropped = await this.repo.deleteOlderThan(KEEP_DAYS);
      this.logger.log({ event: 'import_cleanup', orphans, stuck, dropped });
    } catch (error) {
      this.logger.error({
        event: 'import_cleanup_failed',
        error: String(error),
      });
    }
  }
}
