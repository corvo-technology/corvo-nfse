import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { ScheduleService } from '@/modules/invoice-schedule/application/schedule.service';
import type { InvoiceSchedule } from '@/modules/invoice-schedule/domain/invoice-schedule';
import { ScheduleNotFoundError } from '@/modules/invoice-schedule/domain/schedule-errors';
import {
  toScheduleResponse,
  type ScheduleResponseDto,
} from '@/modules/invoice-schedule/http/schedule.dto';
import {
  ScheduleIdInput,
  ScheduleListInput,
  ScheduleRunsInput,
  ScheduleUpdateInput,
} from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

type Service = Pick<
  ScheduleService,
  'get' | 'list' | 'runs' | 'update' | 'pause' | 'resume' | 'cancel'
>;

const SCHEDULE_ID = {
  schedule_id: { type: 'string', description: 'UUID of the schedule' },
} as const;
const PAGE = {
  limit: { type: 'number', description: '1 to 200, default 50' },
  offset: { type: 'number', description: 'Items to skip, default 0' },
} as const;
const RUN_RULE =
  'Schedules run at 09:00 America/Sao_Paulo on business days (Monday to Friday); a weekend date runs on Monday and the note takes the competence of the day it runs.';

export const SCHEDULE_LIST_TOOL = {
  name: 'schedule_list',
  description: `List scheduled (SCHEDULE) and recurring (RECURRING) invoices in the connected environment. ${RUN_RULE}`,
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'cancelled'],
      },
      company_id: { type: 'string', description: 'UUID of a company' },
      ...PAGE,
    },
    required: [],
  },
} as const;

export const SCHEDULE_GET_TOOL = {
  name: 'schedule_get',
  description:
    'Get one schedule: status, next run date, attempts and the invoice body it issues.',
  inputSchema: {
    type: 'object',
    properties: SCHEDULE_ID,
    required: ['schedule_id'],
  },
} as const;

export const SCHEDULE_RUNS_TOOL = {
  name: 'schedule_runs',
  description:
    'Log of every attempt to run a schedule, newest first: the due date, the day it ran, the result, the invoice it issued or the error.',
  inputSchema: {
    type: 'object',
    properties: { ...SCHEDULE_ID, ...PAGE },
    required: ['schedule_id'],
  },
} as const;

export const SCHEDULE_UPDATE_TOOL = {
  name: 'schedule_update',
  description:
    'Change a schedule. Applies to the next runs only; notes already issued do not change. Send only what changes. Changing frequency or first_date recomputes the next run.',
  inputSchema: {
    type: 'object',
    properties: {
      ...SCHEDULE_ID,
      amount: { type: 'number', description: 'New total in BRL' },
      description: { type: 'string' },
      discount: { type: 'number' },
      deduction: { type: 'number' },
      customer: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tax_id: { type: 'string' },
          email: { type: 'string' },
        },
      },
      send_email: { type: 'boolean' },
      service_code: { type: 'string' },
      municipality_code: { type: 'string' },
      ends_on: {
        type: ['string', 'null'],
        description:
          'YYYY-MM-DD last day, or null to run until paused or cancelled',
      },
      frequency: { type: 'string', enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] },
      first_date: {
        type: 'string',
        description: 'YYYY-MM-DD the count of runs starts from',
      },
    },
    required: ['schedule_id'],
  },
} as const;

export const SCHEDULE_PAUSE_TOOL = {
  name: 'schedule_pause',
  description: 'Pause an active schedule. It stops running until resumed.',
  inputSchema: {
    type: 'object',
    properties: SCHEDULE_ID,
    required: ['schedule_id'],
  },
} as const;

export const SCHEDULE_RESUME_TOOL = {
  name: 'schedule_resume',
  description:
    'Resume a paused schedule (for example one paused after 3 failed attempts). It continues at its next occurrence; runs missed meanwhile are not issued.',
  inputSchema: {
    type: 'object',
    properties: SCHEDULE_ID,
    required: ['schedule_id'],
  },
} as const;

export const SCHEDULE_CANCEL_TOOL = {
  name: 'schedule_cancel',
  description: 'Cancel a schedule. This is final. Notes already issued stay.',
  inputSchema: {
    type: 'object',
    properties: SCHEDULE_ID,
    required: ['schedule_id'],
  },
} as const;

async function parse<T extends object>(
  type: new () => T,
  raw: unknown,
): Promise<T> {
  const params = plainToInstance(type, raw as Record<string, unknown>);
  const errors = await validate(params);
  if (errors.length > 0) throw invalidInput(errors);
  return params;
}

/** A test connection only sees test schedules, a live one only live ones. */
async function owned(
  service: Service,
  id: string,
  ctx: AuthContext,
): Promise<InvoiceSchedule> {
  const schedule = await service.get(id, ctx.tenantId);
  if (schedule.props.environment !== executionEnvironment(ctx))
    throw new ScheduleNotFoundError();
  return schedule;
}

export function createScheduleListHandler(service: Service) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ScheduleListInput, raw);
    const limit = p.limit ?? 50;
    const offset = p.offset ?? 0;
    const result = await service.list(
      ctx.tenantId,
      {
        status: p.status,
        companyId: p.company_id,
        environment: executionEnvironment(ctx),
      },
      { limit, offset },
    );
    return {
      schedules: result.items.map(toScheduleResponse),
      total: result.total,
      limit,
      offset,
    };
  };
}

export function createScheduleGetHandler(service: Service) {
  return async (
    raw: unknown,
    ctx: AuthContext,
  ): Promise<ScheduleResponseDto> => {
    const p = await parse(ScheduleIdInput, raw);
    return toScheduleResponse(await owned(service, p.schedule_id, ctx));
  };
}

export function createScheduleRunsHandler(service: Service) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ScheduleRunsInput, raw);
    await owned(service, p.schedule_id, ctx);
    const limit = p.limit ?? 50;
    const offset = p.offset ?? 0;
    const result = await service.runs(p.schedule_id, ctx.tenantId, {
      limit,
      offset,
    });
    return {
      runs: result.items.map((run) => ({
        id: run.id,
        occurrence_on: run.occurrenceOn,
        ran_on: run.ranOn,
        attempt: run.attempt,
        outcome: run.outcome,
        invoice_id: run.invoiceId,
        error_code: run.errorCode,
        error_message: run.errorMessage,
        created_at: run.createdAt.toISOString(),
      })),
      total: result.total,
      limit,
      offset,
    };
  };
}

type Body = Record<string, unknown>;

/** Only what the caller sent, merged over the stored body so partial objects never drop fields. */
function invoicePatch(p: ScheduleUpdateInput, stored: Body): Body | undefined {
  const patch: Body = {};
  if (p.amount !== undefined) patch.amount = p.amount;
  if (p.discount !== undefined) patch.discount = p.discount;
  if (p.deduction !== undefined) patch.deduction = p.deduction;
  if (p.customer)
    patch.customer = {
      ...(stored.customer as Body | undefined),
      ...(p.customer.tax_id !== undefined ? { taxId: p.customer.tax_id } : {}),
      ...(p.customer.name !== undefined ? { name: p.customer.name } : {}),
      ...(p.customer.email !== undefined ? { email: p.customer.email } : {}),
    };
  if (
    p.description !== undefined ||
    p.service_code !== undefined ||
    p.municipality_code !== undefined
  )
    patch.service = {
      ...(stored.service as Body | undefined),
      ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.service_code !== undefined ? { code: p.service_code } : {}),
      ...(p.municipality_code !== undefined
        ? { municipalityCode: p.municipality_code }
        : {}),
    };
  if (p.send_email !== undefined)
    patch.options = {
      ...(stored.options as Body | undefined),
      email: { send: p.send_email },
    };
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export function createScheduleUpdateHandler(service: Service) {
  return async (
    raw: unknown,
    ctx: AuthContext,
  ): Promise<ScheduleResponseDto> => {
    const p = await parse(ScheduleUpdateInput, raw);
    const current = await owned(service, p.schedule_id, ctx);
    const updated = await service.update(p.schedule_id, ctx.tenantId, {
      invoice: invoicePatch(p, current.props.invoiceInput),
      endsOn: p.ends_on,
      frequency: p.frequency,
      anchorOn: p.first_date,
    });
    return toScheduleResponse(updated);
  };
}

function createActionHandler(
  service: Service,
  action: 'pause' | 'resume' | 'cancel',
) {
  return async (
    raw: unknown,
    ctx: AuthContext,
  ): Promise<ScheduleResponseDto> => {
    const p = await parse(ScheduleIdInput, raw);
    await owned(service, p.schedule_id, ctx);
    return toScheduleResponse(
      await service[action](p.schedule_id, ctx.tenantId),
    );
  };
}
export const createSchedulePauseHandler = (service: Service) =>
  createActionHandler(service, 'pause');
export const createScheduleResumeHandler = (service: Service) =>
  createActionHandler(service, 'resume');
export const createScheduleCancelHandler = (service: Service) =>
  createActionHandler(service, 'cancel');
