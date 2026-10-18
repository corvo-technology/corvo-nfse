import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DEFAULT_ESTABLISHMENT_TIMEZONE } from '@/shared/dates/date-time';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  INVOICE_OVERVIEW_REPOSITORY,
  type IInvoiceOverviewRepository,
  type OverviewPeriod,
} from '../domain/invoice-overview.repository';

@Injectable()
export class InvoiceOverviewService {
  constructor(
    @Inject(INVOICE_OVERVIEW_REPOSITORY)
    private readonly repository: IInvoiceOverviewRepository,
  ) {}

  async get(
    tenantId: string,
    environment: ExecutionEnvironment,
    period: OverviewPeriod,
  ) {
    const timezone = DEFAULT_ESTABLISHMENT_TIMEZONE;
    const days = period === '7d' ? 7 : 30;
    const today = DateTime.now().setZone(timezone).startOf('day');
    const start = today.minus({ days: days - 1 });
    const result = await this.repository.read(tenantId, environment, {
      start: start.toJSDate(),
      end: today.plus({ days: 1 }).toJSDate(),
      timezone,
    });
    const activity = new Map(
      result.dailyActivity.map((day) => [day.date, day.count]),
    );
    return {
      period,
      from: start.toISODate()!,
      to: today.toISODate()!,
      timezone,
      counts: result.counts,
      dailyActivity: Array.from({ length: days }, (_, i) => {
        const date = start.plus({ days: i }).toISODate()!;
        return { date, count: activity.get(date) ?? 0 };
      }),
      recentInvoices: result.recentInvoices,
    };
  }
}
