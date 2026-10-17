import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { DOCUMENT_STORAGE } from './domain/document-storage';
import { S3DocumentStorage } from './infra/s3-storage';

@Global()
@Module({
  imports: [ConfigModule],
})
export class StorageModule {
  static forRoot(): DynamicModule {
    const storageProvider = {
      provide: DOCUMENT_STORAGE,
      useFactory: (configService: ConfigService) => {
        return new S3DocumentStorage(
          configService,
          new S3Client({
            region:
              configService.get<string>('storage.s3Region') || 'us-east-1',
            requestChecksumCalculation: 'WHEN_REQUIRED',
            forcePathStyle:
              configService.get<boolean>('storage.s3ForcePathStyle') ?? true,
            ...(configService.get<string>('storage.s3Endpoint')
              ? { endpoint: configService.get<string>('storage.s3Endpoint') }
              : {}),
            ...(configService.get<string>('storage.s3AccessKeyId')
              ? {
                  credentials: {
                    accessKeyId: configService.get<string>(
                      'storage.s3AccessKeyId',
                    )!,
                    secretAccessKey:
                      configService.get<string>('storage.s3SecretAccessKey') ??
                      '',
                  },
                }
              : {}),
          }),
        );
      },
      inject: [ConfigService],
    };

    return {
      module: StorageModule,
      providers: [storageProvider],
      exports: [DOCUMENT_STORAGE],
    };
  }
}
