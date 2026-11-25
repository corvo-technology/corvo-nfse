import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { IdempotencyConflictError } from '@/modules/invoice/domain/errors';
import { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { recordSafely } from '@/shared/audit/record-safely';
import { validationExceptionFactory } from '@/shared/http/validation-pipe';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import {
  InvoiceSchedule,
  ScheduleValidationError,
  type ScheduleKind,
  type ScheduleStatus,
  type UpdateScheduleInput,
} from '../domain/invoice-schedule';
import {
  InvoiceScheduleRepository,
  type SchedulePage,
  type ScheduleRun,
  type ScheduleListResult,
} from '../domain/invoice-schedule.repository';
import {
  ScheduleLimitError,
  ScheduleNotFoundError,
} from '../domain/schedule-errors';
import { type Frequency, todayInSaoPaulo } from '../domain/recurrence';

/** Active schedules per workspace: keeps the daily run bounded. */
export const MAX_ACTIVE_SCHEDULES = 200;
export const SCHEDULE_HORIZON_DAYS = 'SCHEDULE_HORIZON_DAYS';
export const SCHEDULE_INVOICE_PORT = 'SCHEDULE_INVOICE_PORT';

export type ScheduleInvoicePort = Pick<
  InvoiceService,
  'prepareEmissionInEnvironment'
>;

/** What the emission request says about scheduling, read from `options`. */
interface ScheduleOptions {
  type?: string;
  recurrence?: { frequency?: Frequency; endsOn?: string };
}

export interface UpdateSchedulePatch {
  /** Fields of the invoice body to change (merged over what is stored). */
  invoice?: Record<string, unknown>;
  endsOn?: string | null;
  frequency?: Frequency;
  anchorOn?: string;
}

const KIND_BY_TYPE: Record<string, ScheduleKind> = {
  SCHEDULE: 'once',
  RECURRING: 'recurring',
};

@Injectable()
export class ScheduleService {
  constructor(
    private readonly repo: InvoiceScheduleRepository,
    @Inject(SCHEDULE_INVOICE_PORT)
    private readonly invoices: ScheduleInvoicePort,
    @Inject(SCHEDULE_HORIZON_DAYS) private readonly horizonDays: number,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly audit: AccountAuditRecorder,
  ) {}

  /** Recorded after the write is committed, never inside the transaction. */
  private async record(
    action:
      | 'schedule.created'
      | 'schedule.paused'
      | 'schedule.resumed'
      | 'schedule.cancelled',
    schedule: InvoiceSchedule,
  ): Promise<InvoiceSchedule> {
    await recordSafely(this.audit, {
      tenantId: schedule.props.tenantId,
      environment: schedule.props.environment,
      action,
      target: { type: 'schedule', id: schedule.props.id },
    });
    return schedule;
  }

  /** `POST /invoices` with `options.type` SCHEDULE or RECURRING. */
  async createFromEmission(
    dto: CreateInvoiceDto,
    tenantId: string,
    authContext: AuthContext,
    now: Date = new Date(),
    idempotencyKey?: string,
  ): Promise<InvoiceSchedule> {
    const options: ScheduleOptions =
      (dto as { options?: ScheduleOptions }).options ?? {};
    const kind = KIND_BY_TYPE[options.type ?? ''];
    if (!kind)
      throw new ScheduleValidationError(
        'options.type',
        'invalid',
        'options.type must be SCHEDULE or RECURRING',
      );
    if (!/^\d{4}-\d{2}-\d{2}/.test(dto.competenceDate ?? ''))
      throw new ScheduleValidationError(
        'competenceDate',
        'invalid_date',
        'competenceDate must be a valid date',
      );
    const environment = executionEnvironment(authContext);
    const requestHash = hashRequest(dto);
    if (idempotencyKey) {
      const replay = await this.replayOf(
        tenantId,
        environment,
        idempotencyKey,
        requestHash,
      );
      if (replay) return replay;
    }
    await this.assertRoomForOne(tenantId);

    const body = invoiceBody(dto);
    const companyId = await this.validate(body, tenantId, environment, now);
    const schedule = InvoiceSchedule.create(
      {
        tenantId,
        environment,
        companyId,
        kind,
        frequency: options.recurrence?.frequency ?? null,
        firstOn: dto.competenceDate.slice(0, 10),
        endsOn: options.recurrence?.endsOn ?? null,
        invoiceInput: { ...withoutCompanyTaxId(body), companyId },
        createdBy: authContext.authUserId ?? null,
        idempotencyKey: idempotencyKey ?? null,
        requestHash: idempotencyKey ? requestHash : null,
      },
      now,
      this.horizonDays,
    );
    try {
      await this.repo.insert(schedule);
    } catch (error) {
      // A concurrent request with the same key won the unique index: answer with its schedule.
      if (idempotencyKey && (error as { code?: string }).code === '23505') {
        const replay = await this.replayOf(
          tenantId,
          environment,
          idempotencyKey,
          requestHash,
        );
        if (replay) return replay;
      }
      throw error;
    }
    return this.record('schedule.created', schedule);
  }

  /** The schedule a previous request with this key created, or a conflict if the request differs. */
  private async replayOf(
    tenantId: string,
    environment: 'test' | 'live',
    key: string,
    requestHash: string,
  ): Promise<InvoiceSchedule | null> {
    const existing = await this.repo.findByIdempotencyKey(
      tenantId,
      environment,
      key,
    );
    if (!existing) return null;
    if (existing.props.requestHash !== requestHash)
      throw new IdempotencyConflictError(key);
    return existing;
  }

  async get(id: string, tenantId: string): Promise<InvoiceSchedule> {
    const schedule = await this.repo.findById(id, tenantId);
    if (!schedule) throw new ScheduleNotFoundError();
    return schedule;
  }

  list(
    tenantId: string,
    filter: {
      status?: ScheduleStatus;
      companyId?: string;
      environment?: 'test' | 'live';
    },
    page: SchedulePage,
  ): Promise<ScheduleListResult<InvoiceSchedule>> {
    return this.repo.list(tenantId, filter, page);
  }

  async runs(
    id: string,
    tenantId: string,
    page: SchedulePage,
  ): Promise<ScheduleListResult<ScheduleRun>> {
    await this.get(id, tenantId);
    return this.repo.listRuns(id, tenantId, page);
  }

  /**
   * Reads the schedule FOR UPDATE, changes it and saves it in one transaction. The daily run locks
   * the same row, so a change made at 09:00 waits for it and starts from what the run saved,
   * instead of overwriting it with a stale copy.
   */
  private mutate(
    id: string,
    tenantId: string,
    change: (schedule: InvoiceSchedule) => Promise<void> | void,
  ): Promise<InvoiceSchedule> {
    return runWithTenant(tenantId, () =>
      this.unitOfWork.execute(async () => {
        const schedule = await this.repo.findById(id, tenantId, {
          forUpdate: true,
        });
        if (!schedule) throw new ScheduleNotFoundError();
        await change(schedule);
        await this.repo.save(schedule);
        return schedule;
      }),
    );
  }

  async update(
    id: string,
    tenantId: string,
    patch: UpdateSchedulePatch,
    now: Date = new Date(),
  ): Promise<InvoiceSchedule> {
    return this.mutate(id, tenantId, async (schedule) => {
      const change: UpdateScheduleInput = {
        endsOn: patch.endsOn,
        frequency: patch.frequency,
        anchorOn: patch.anchorOn,
      };
      if (patch.invoice) {
        const merged = { ...schedule.props.invoiceInput, ...patch.invoice };
        await assertEditableInvoicePatch(patch.invoice);
        await this.validate(merged, tenantId, schedule.props.environment, now);
        change.invoiceInput = merged;
      }
      schedule.update(change, todayInSaoPaulo(now), this.horizonDays);
    });
  }

  async pause(id: string, tenantId: string): Promise<InvoiceSchedule> {
    const schedule = await this.mutate(id, tenantId, (s) => s.pause());
    return this.record('schedule.paused', schedule);
  }

  async resume(
    id: string,
    tenantId: string,
    now: Date = new Date(),
  ): Promise<InvoiceSchedule> {
    const schedule = await this.mutate(id, tenantId, async (s) => {
      await this.assertRoomForOne(tenantId);
      s.resume(todayInSaoPaulo(now));
    });
    return this.record('schedule.resumed', schedule);
  }

  async cancel(id: string, tenantId: string): Promise<InvoiceSchedule> {
    const schedule = await this.mutate(id, tenantId, (s) => s.cancel());
    return this.record('schedule.cancelled', schedule);
  }

  private async assertRoomForOne(tenantId: string): Promise<void> {
    if ((await this.repo.countActive(tenantId)) >= MAX_ACTIVE_SCHEDULES)
      throw new ScheduleLimitError(MAX_ACTIVE_SCHEDULES);
  }

  /**
   * The body is validated exactly like a normal emission, as if it were issued today.
   * Nothing is persisted. Returns the company the body resolves to.
   */
  private async validate(
    body: Record<string, unknown>,
    tenantId: string,
    environment: 'test' | 'live',
    now: Date,
  ): Promise<string> {
    const prepared = await this.invoices.prepareEmissionInEnvironment(
      { ...body, competenceDate: todayInSaoPaulo(now) } as CreateInvoiceDto,
      tenantId,
      environment,
    );
    return prepared.invoice.companyId;
  }
}

/** The invoice request minus what the schedule owns: dates and the scheduling options. */
function invoiceBody(dto: CreateInvoiceDto): Record<string, unknown> {
  const {
    competenceDate: _date,
    options,
    ...rest
  } = dto as unknown as {
    competenceDate: string;
    options?: Record<string, unknown>;
  } & Record<string, unknown>;
  const kept: Record<string, unknown> = { ...rest };
  if (options) {
    const { type: _type, recurrence: _recurrence, ...others } = options;
    if (Object.keys(others).length > 0) kept.options = others;
  }
  return kept;
}

function withoutCompanyTaxId(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { companyTaxId: _taxId, ...rest } = body;
  return rest;
}

/** Fields the schedule itself owns: the PATCH body may not touch them. */
const OWNED_BY_THE_SCHEDULE = [
  'companyId',
  'companyTaxId',
  'competenceDate',
] as const;

/**
 * The part of the invoice a PATCH may change: shaped like a normal emission (so a malformed body
 * is a 4xx, not a crash further down) and never the company, the dates or the scheduling options.
 */
async function assertEditableInvoicePatch(
  patch: Record<string, unknown>,
): Promise<void> {
  for (const key of OWNED_BY_THE_SCHEDULE)
    if (patch[key] !== undefined)
      throw new ScheduleValidationError(
        `invoice.${key}`,
        'not_allowed',
        `invoice.${key} cannot be changed on a schedule`,
      );
  const options = patch.options;
  if (options && typeof options === 'object')
    for (const key of ['type', 'recurrence'])
      if ((options as Record<string, unknown>)[key] !== undefined)
        throw new ScheduleValidationError(
          `invoice.options.${key}`,
          'not_allowed',
          `invoice.options.${key} cannot be changed on a schedule`,
        );
  // Only the fields the PATCH carries: a stored body made through MCP legitimately lacks fields
  // the emission inherits from the company (e.g. service.code), so the rest is not judged here.
  const errors = (
    await validate(plainToInstance(CreateInvoiceDto, patch))
  ).filter((error) => Object.keys(patch).includes(error.property));
  if (errors.length > 0) throw validationExceptionFactory(errors);
}

/** Same request, same hash: keys sorted at every level so field order never matters. */
function hashRequest(dto: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(dto)))
    .digest('hex');
}
