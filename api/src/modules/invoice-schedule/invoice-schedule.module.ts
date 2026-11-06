import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { OutboxConfig } from '@/infra/config/configuration.types';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { CompanyModule } from '@/modules/company/company.module';
import { EmailModule } from '@/modules/email/email.module';
import { CreditsAlertsModule } from '@/modules/credits-alerts/credits-alerts.module';
import { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { InvoiceScheduleRepository } from './domain/invoice-schedule.repository';
import { InvoiceScheduleOrmEntity } from './infra/invoice-schedule.orm-entity';
import { InvoiceScheduleRunOrmEntity } from './infra/invoice-schedule-run.orm-entity';
import { TypeOrmInvoiceScheduleRepository } from './infra/typeorm-invoice-schedule.repository';
import { ScheduleFailureNotifier } from './domain/schedule-failure.notifier';
import { ScheduleEmailNotifier } from './application/schedule-email.notifier';
import { EmissionRouterService } from './application/emission-router.service';
import { ScheduleController } from './http/schedule.controller';
import { ScheduleRunner } from './application/schedule-runner.service';
import { ScheduleCron } from './jobs/schedule.cron';
import {
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_INVOICE_PORT,
  ScheduleService,
} from './application/schedule.service';

@Module({
  imports: [
    forwardRef(() => InvoiceModule),
    CompanyModule,
    EmailModule,
    CreditsAlertsModule,
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
    {
      provide: ScheduleFailureNotifier,
      useClass: ScheduleEmailNotifier,
    },
    ScheduleService,
    EmissionRouterService,
    ScheduleRunner,
    ScheduleCron,
  ],
  controllers: [ScheduleController],
  exports: [ScheduleService, EmissionRouterService, InvoiceScheduleRepository],
})
export class InvoiceScheduleModule {}
