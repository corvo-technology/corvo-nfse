import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { OutboxConfig } from '@/infra/config/configuration.types';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { InvoiceScheduleRepository } from './domain/invoice-schedule.repository';
import { InvoiceScheduleOrmEntity } from './infra/invoice-schedule.orm-entity';
import { InvoiceScheduleRunOrmEntity } from './infra/invoice-schedule-run.orm-entity';
import { TypeOrmInvoiceScheduleRepository } from './infra/typeorm-invoice-schedule.repository';
import { ScheduleFailureNotifier } from './domain/schedule-failure.notifier';
import { LoggingScheduleFailureNotifier } from './application/logging-schedule-failure.notifier';
import { ScheduleRunner } from './application/schedule-runner.service';
import { ScheduleCron } from './jobs/schedule.cron';
import {
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_INVOICE_PORT,
  ScheduleService,
} from './application/schedule.service';

@Module({
  imports: [
    InvoiceModule,
    TypeOrmModule.forFeature([
      InvoiceScheduleOrmEntity,
      InvoiceScheduleRunOrmEntity,
    ]),
  ],
  providers: [
    {
      provide: InvoiceScheduleRepository,
      useClass: TypeOrmInvoiceScheduleRepository,
    },
    {
      provide: SCHEDULE_INVOICE_PORT,
      useExisting: InvoiceService,
    },
    {
      provide: SCHEDULE_HORIZON_DAYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<OutboxConfig>('outbox')?.scheduleMaxDays ?? 15,
    },
    // Replaced by the e-mail notifier in the notifications task.
    {
      provide: ScheduleFailureNotifier,
      useClass: LoggingScheduleFailureNotifier,
    },
    ScheduleService,
    ScheduleRunner,
    ScheduleCron,
  ],
  exports: [ScheduleService, InvoiceScheduleRepository],
})
export class InvoiceScheduleModule {}
