import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@/modules/auth/auth-context';
import { InvoiceService } from '@/modules/invoice/application/invoice.service';
import type { Invoice } from '@/modules/invoice/domain/invoice';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import {
  InvoiceSchedule,
  ScheduleValidationError,
} from '../domain/invoice-schedule';
import { ScheduleService } from './schedule.service';

export type EmissionResult =
  | { kind: 'invoice'; invoice: Invoice }
  | { kind: 'schedule'; schedule: InvoiceSchedule };

/**
 * One entry point for `POST /invoices` and the MCP tool: IMMEDIATE issues a note as always,
 * SCHEDULE and RECURRING create a schedule instead (the note only exists when it runs).
 */
@Injectable()
export class EmissionRouterService {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly schedules: ScheduleService,
  ) {}

  async emit(
    dto: CreateInvoiceDto,
    tenantId: string,
    authContext: AuthContext,
    idempotencyKey?: string,
  ): Promise<EmissionResult> {
    const options = dto.options;
    if (options?.type === 'SCHEDULE' || options?.type === 'RECURRING')
      return {
        kind: 'schedule',
        schedule: await this.schedules.createFromEmission(
          dto,
          tenantId,
          authContext,
          undefined,
          idempotencyKey,
        ),
      };
    if (options?.recurrence)
      throw new ScheduleValidationError(
        'options.recurrence',
        'not_allowed',
        'options.recurrence is only allowed when options.type is RECURRING',
      );
    return {
      kind: 'invoice',
      invoice: await this.invoices.emit(
        dto,
        tenantId,
        authContext,
        idempotencyKey,
      ),
    };
  }
}
