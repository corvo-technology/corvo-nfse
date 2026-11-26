import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  IDocumentStorage,
  DocumentFormat,
  SignedDocumentUrl,
  StorageRef,
} from '../domain/document-storage';

const FILE_NAME = /^[a-z0-9][a-z0-9._/-]{0,80}$/;

const CONTENT_TYPES: Record<string, string> = {
  xml: 'application/xml',
  pdf: 'application/pdf',
};

@Injectable()
export class S3DocumentStorage implements IDocumentStorage {
  private readonly logger = new Logger(S3DocumentStorage.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly client: S3Client,
  ) {}

  private get bucket(): string {
    return this.configService.get<string>('storage.s3Bucket') || 'corvo-nfse';
  }

  private get s3Endpoint(): string | undefined {
    return this.configService.get<string>('storage.s3Endpoint');
  }

  private getKey(
    tenantId: string,
    invoiceId: string,
    format: DocumentFormat,
    environment?: ExecutionEnvironment,
  ): string {
    return `${tenantId}/${environment ? `${environment}/` : ''}invoices/${invoiceId}/invoice.${format}`;
  }

  async saveXml(
    tenantId: string,
    invoiceId: string,
    xml: string,
    environment?: ExecutionEnvironment,
  ): Promise<string> {
    const key = this.getKey(tenantId, invoiceId, 'xml', environment);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: xml,
        ContentType: 'application/xml',
      }),
    );
    this.logger.debug(`Saved XML to S3: ${key}`);
    return key;
  }

  async getXml(
    tenantId: string,
    invoiceId: string,
    environment?: ExecutionEnvironment,
  ): Promise<string> {
    const key = this.getKey(tenantId, invoiceId, 'xml', environment);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    return response.Body!.transformToString('utf-8');
  }

  async savePdf(
    tenantId: string,
    invoiceId: string,
    pdf: Buffer,
    environment?: ExecutionEnvironment,
  ): Promise<string> {
    const key = this.getKey(tenantId, invoiceId, 'pdf', environment);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: 'application/pdf',
        Body: pdf,
      }),
    );
    this.logger.debug(`Saved PDF to S3: ${key}`);
    return key;
  }

  async getPdf(
    tenantId: string,
    invoiceId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Buffer> {
    const key = this.getKey(tenantId, invoiceId, 'pdf', environment);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    return Buffer.from(await response.Body!.transformToByteArray());
  }

  async exists(
    tenantId: string,
    invoiceId: string,
    format: DocumentFormat,
    environment?: ExecutionEnvironment,
  ): Promise<boolean> {
    const key = this.getKey(tenantId, invoiceId, format, environment);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return response.$metadata.httpStatusCode !== 404;
    } catch (error: unknown) {
      const e = error as { $metadata?: { httpStatusCode?: number } };
      if (e.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async getSignedUrl(
    tenantId: string,
    invoiceId: string,
    format: DocumentFormat,
    options: { fileName: string; expiresInSeconds?: number },
    environment?: ExecutionEnvironment,
  ): Promise<SignedDocumentUrl> {
    const key = this.getKey(tenantId, invoiceId, format, environment);
    const expiresIn = options.expiresInSeconds ?? 300;
    const mimeType = format === 'xml' ? 'application/xml' : 'application/pdf';

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${options.fileName}"`,
        ResponseContentType: mimeType,
      }),
      { expiresIn },
    );

    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      fileName: options.fileName,
      mimeType,
    };
  }

  /** The key of a file by reference; the name is checked so it can never leave the folder. */
  private refKey(ref: StorageRef, fileName: string): string {
    if (!FILE_NAME.test(fileName) || fileName.includes('..'))
      throw new Error('Invalid file name');
    const base = `${ref.tenantId}/${ref.environment}`;
    if (ref.type === 'nfe') return `${base}/nfe/${ref.id}/${fileName}`;
    if (ref.type === 'nfe-inutilization')
      return `${base}/nfe-inutilizacoes/${ref.id}.xml`;
    throw new Error(`The storage does not store files of type ${ref.type}`);
  }

  async saveFile(
    ref: StorageRef,
    fileName: string,
    body: Buffer | string,
    contentType: string,
  ): Promise<string> {
    const key = this.refKey(ref, fileName);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.logger.debug(`Saved file to S3: ${key}`);
    return key;
  }

  async getFile(ref: StorageRef, fileName: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.refKey(ref, fileName),
      }),
    );
    return Buffer.from(await response.Body!.transformToByteArray());
  }

  async fileExists(ref: StorageRef, fileName: string): Promise<boolean> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.refKey(ref, fileName),
        }),
      );
      return response.$metadata.httpStatusCode !== 404;
    } catch (error: unknown) {
      const e = error as { $metadata?: { httpStatusCode?: number } };
      if (e.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  async getFileSignedUrl(
    ref: StorageRef,
    fileName: string,
    options: { downloadName: string; expiresInSeconds?: number },
  ): Promise<SignedDocumentUrl> {
    const key = this.refKey(ref, fileName);
    const expiresIn = options.expiresInSeconds ?? 300;
    const mimeType =
      CONTENT_TYPES[fileName.slice(fileName.lastIndexOf('.') + 1)] ??
      'application/octet-stream';
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${options.downloadName}"`,
        ResponseContentType: mimeType,
      }),
      { expiresIn },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      fileName: options.downloadName,
      mimeType,
    };
  }
}
