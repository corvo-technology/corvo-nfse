import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { CompanyService } from '@/modules/company/application/company.service';
import { MAX_IMPORT_BYTES, type ImportStatus } from '../domain/import';
import { ImportRepository } from '../domain/import.repository';
import {
  ImportFileInvalidError,
  ImportFileTooLargeError,
} from '../domain/import-error';
import { ImportFileStorage } from '../infra/import-file-storage';

export const IMPORT_READ_QUEUE = 'import-read';
export type ImportReadJob = {
  tenantId: string;
  environment: ExecutionEnvironment;
  importId: string;
};
export const IMPORT_READ_ATTEMPTS = 3;

export type StartImportInput = {
  tenantId: string;
  environment: ExecutionEnvironment;
  userId: string;
  fileName: string;
  bytes: Buffer;
  companyId?: string;
};

export type StartImportResult = {
  id: string;
  status: ImportStatus;
  duplicateOf: string | null;
};

@Injectable()
export class ImportIntakeService {
  constructor(
    private readonly repo: ImportRepository,
    private readonly storage: ImportFileStorage,
    @InjectQueue(IMPORT_READ_QUEUE)
    private readonly queue: Queue<ImportReadJob>,
    private readonly companies: CompanyService,
  ) {}

  async start(input: StartImportInput): Promise<StartImportResult> {
    if (!/\.(csv|xlsx)$/i.test(input.fileName))
      throw new ImportFileInvalidError();
    if (input.bytes.length > MAX_IMPORT_BYTES)
      throw new ImportFileTooLargeError();
    const { tenantId, environment } = input;
    if (input.companyId)
      await this.companies.findById(input.companyId, tenantId, environment);

    const fileHash = createHash('sha256').update(input.bytes).digest('hex');
    const companyId = input.companyId ?? null;
    const earlier = await this.repo.findByFileHash(
      tenantId,
      environment,
      companyId,
      fileHash,
    );

    const created = await this.repo.create({
      id: randomUUID(),
      tenantId,
      environment,
      userId: input.userId,
      fileName: input.fileName.slice(0, 255),
      fileHash,
      companyId,
    });
    try {
      await this.storage.save(tenantId, environment, created.id, input.bytes);
      await this.queue.add(
        'read',
        { tenantId, environment, importId: created.id },
        {
          attempts: IMPORT_READ_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        },
      );
    } catch (error) {
      await this.storage
        .remove(tenantId, environment, created.id)
        .catch(() => undefined);
      await this.repo.delete(tenantId, created.id).catch(() => undefined);
      throw error;
    }
    return {
      id: created.id,
      status: created.status,
      duplicateOf: earlier?.id ?? null,
    };
  }
}
