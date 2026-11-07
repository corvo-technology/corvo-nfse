import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  IMPORT_EMIT_ATTEMPTS,
  IMPORT_EMIT_QUEUE,
  ImportEmitService,
} from '../application/import-emit.service';
import type { ImportRef } from '../application/import-reader.service';

@Processor(IMPORT_EMIT_QUEUE)
@Injectable()
export class ImportEmitProcessor extends WorkerHost {
  constructor(private readonly emitter: ImportEmitService) {
    super();
  }

  async process(job: Job<ImportRef>): Promise<void> {
    try {
      await this.emitter.run(job.data);
    } catch (error) {
      if (job.attemptsMade + 1 < IMPORT_EMIT_ATTEMPTS) throw error;
      await this.emitter.failRun(job.data);
    }
  }
}
