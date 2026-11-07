import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { S3_CLIENT } from '@/infra/storage/domain/document-storage';

export type StoredImportRef = {
  tenantId: string;
  environment: ExecutionEnvironment;
  importId: string;
};

/**
 * Holds an uploaded spreadsheet only until the reading job finishes. The key never carries the
 * original file name, and the file is never handed out through a link: only the worker reads it.
 */
@Injectable()
export class ImportFileStorage {
  constructor(
    private readonly config: ConfigService,
    @Inject(S3_CLIENT) private readonly client: S3Client,
  ) {}

  private get bucket(): string {
    return this.config.get<string>('storage.s3Bucket') || 'corvo-nfse';
  }

  private key(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
  ): string {
    return `imports/${tenantId}/${env}/${importId}`;
  }

  async save(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
    bytes: Buffer,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(tenantId, env, importId),
        Body: bytes,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async read(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
  ): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(tenantId, env, importId),
      }),
    );
    if (!out.Body) throw new Error('Import file is empty in storage');
    return Buffer.from(await out.Body.transformToByteArray());
  }

  /** S3 answers 204 for a key that is not there, so removing twice is safe. */
  async remove(
    tenantId: string,
    env: ExecutionEnvironment,
    importId: string,
  ): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.key(tenantId, env, importId),
      }),
    );
  }

  /** Files that outlived their reading job (a crash, a lost message). */
  async listOlderThan(hours: number): Promise<StoredImportRef[]> {
    const limit = Date.now() - hours * 3600_000;
    const found: StoredImportRef[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: 'imports/',
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        const [, tenantId, environment, importId] = (object.Key ?? '').split(
          '/',
        );
        if (
          !tenantId ||
          !importId ||
          (environment !== 'test' && environment !== 'live')
        )
          continue;
        if (object.LastModified && object.LastModified.getTime() < limit)
          found.push({ tenantId, environment, importId });
      }
      token = page.NextContinuationToken;
    } while (token);
    return found;
  }
}
