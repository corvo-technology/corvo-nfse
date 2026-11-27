import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CompanyModule } from '@/modules/company/company.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { ImportController } from './http/import.controller';
import { ImportRepository } from './domain/import.repository';
import { ImportOrmEntity } from './infra/import.orm-entity';
import { ImportRowOrmEntity } from './infra/import-row.orm-entity';
import { TypeOrmImportRepository } from './infra/typeorm-import.repository';
import { ImportFileStorage } from './infra/import-file-storage';
import {
  IMPORT_READ_QUEUE,
  ImportIntakeService,
} from './application/import-intake.service';
import { ImportReaderService } from './application/import-reader.service';
import {
  IMPORT_EMIT_QUEUE,
  IMPORT_EMIT_TEST_QUEUE,
  ImportEmitService,
} from './application/import-emit.service';
import { ImportReviewService } from './application/import-review.service';

@Module({
  imports: [
    CompanyModule,
    InvoiceModule,
    TypeOrmModule.forFeature([ImportOrmEntity, ImportRowOrmEntity]),
    BullModule.registerQueue(
      { name: IMPORT_READ_QUEUE },
      { name: IMPORT_EMIT_QUEUE },
      { name: IMPORT_EMIT_TEST_QUEUE },
    ),
  ],
  providers: [
    { provide: ImportRepository, useClass: TypeOrmImportRepository },
    ImportFileStorage,
    ImportIntakeService,
    ImportReaderService,
    ImportReviewService,
    ImportEmitService,
  ],
  controllers: [ImportController],
  exports: [
    ImportRepository,
    ImportFileStorage,
    ImportReaderService,
    ImportEmitService,
    ImportIntakeService,
    ImportReviewService,
  ],
})
export class ImportModule {}
