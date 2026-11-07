import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ImportReaderService } from '../application/import-reader.service';
import {
  IMPORT_READ_ATTEMPTS,
  IMPORT_READ_QUEUE,
  type ImportReadJob,
} from '../application/import-intake.service';

@Processor(IMPORT_READ_QUEUE)
@Injectable()
export class ImportReadProcessor extends WorkerHost {
  constructor(private readonly reader: ImportReaderService) {
    super();
  }

  async process(job: Job<ImportReadJob>): Promise<void> {
    try {
      await this.reader.read(job.data);
    } catch (error) {
      if (job.attemptsMade + 1 < IMPORT_READ_ATTEMPTS) throw error;
      await this.reader.markFailed(job.data, 'ERROR_IMPORT_UNREADABLE');
    }
  }
}
