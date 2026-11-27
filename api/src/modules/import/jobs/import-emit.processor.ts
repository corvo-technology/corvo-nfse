import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applyTestConcurrency } from '@/infra/redis/test-queue-concurrency';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  IMPORT_EMIT_ATTEMPTS,
  IMPORT_EMIT_QUEUE,
  IMPORT_EMIT_TEST_QUEUE,
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

/** Test (homologação) imports: same job, own queue, so they never hold up a live import. */
@Processor(IMPORT_EMIT_TEST_QUEUE)
@Injectable()
export class ImportEmitTestProcessor
  extends ImportEmitProcessor
  implements OnApplicationBootstrap
{
  @Inject(ConfigService) private readonly appConfig?: ConfigService;
  onApplicationBootstrap(): void {
    applyTestConcurrency(this.worker, this.appConfig);
  }
}
