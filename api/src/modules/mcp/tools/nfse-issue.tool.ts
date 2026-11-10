import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { EmissionRouterService } from '@/modules/invoice-schedule/application/emission-router.service';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import { NfseIssueInput } from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

/** Per-invoice fields, shared with nfse_issue_batch items. */
export const NFSE_ISSUE_PROPERTIES = {
  company_tax_id: {
    type: 'string',
    description:
      'CNPJ of the issuing company (punctuation optional). Alternative to company_id.',
  },
  company_id: {
    type: 'string',
    description:
      'UUID of the issuing company (see company_list). Wins over company_tax_id when both are sent.',
  },
  amount: {
    type: 'number',
    description:
      'Total value of the service in BRL. Use this or services, not both.',
  },
  description: {
    type: 'string',
    description:
      'Optional service description (used with amount). When omitted, the name of the service code is used.',
  },
  services: {
    type: 'array',
    description:
      'Itemized alternative to amount: the total is the sum of quantity x unit_price.',
    items: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        quantity: { type: 'number' },
        unit_price: { type: 'number' },
      },
      required: ['description', 'quantity', 'unit_price'],
    },
  },
  customer: {
    type: 'object',
    description:
      'Tomador. Optional: omit it for an invoice without tomador. When sent with any data, tax_id (CPF or CNPJ) is required.',
    properties: {
      name: { type: 'string' },
      tax_id: {
        type: 'string',
        description: 'CPF or CNPJ of the customer',
      },
      email: { type: 'string' },
      foreign: {
        type: 'object',
        description:
          'Customer outside Brazil. Replaces tax_id and address; name is then required. It does not declare a service export.',
        properties: {
          tax_id: {
            type: 'string',
            description: "Tax id in the customer's country",
          },
          no_tax_id_reason: {
            type: 'string',
            enum: ['exempt', 'not_required'],
            description: 'Only when the customer has no tax id',
          },
          country: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 code, other than BR',
          },
          postal_code: { type: 'string' },
          city: { type: 'string' },
          region: { type: 'string', description: 'State, province or region' },
          street: { type: 'string' },
          number: { type: 'string' },
          district: { type: 'string' },
          complement: { type: 'string' },
        },
        required: [
          'country',
          'postal_code',
          'city',
          'region',
          'street',
          'number',
          'district',
        ],
      },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
        },
      },
    },
  },
  discount: {
    type: 'number',
    description: 'Unconditional discount in BRL (>= 0, at most the amount).',
  },
  deduction: {
    type: 'number',
    description:
      'Deduction from the ISS tax base in BRL, declared by the issuer (> 0 and less than amount minus discount). The issuer is responsible for the declared value; Corvo does not check whether the deduction is allowed.',
  },
  purchase_order: {
    type: 'string',
    maxLength: 60,
    description:
      'Purchase order, service order or project number the customer asked to see on the invoice. Does not change any tax.',
  },
  notes: {
    type: 'string',
    maxLength: 2000,
    description:
      'Free text printed on the invoice as complementary information. Does not change any tax.',
  },
  competence_date: {
    type: 'string',
    description:
      'YYYY-MM-DD. Defaults to today (America/Sao_Paulo). With emission_type SCHEDULE or RECURRING it is required and is the date of the first run (from tomorrow on).',
  },
  emission_type: {
    type: 'string',
    enum: ['IMMEDIATE', 'SCHEDULE', 'RECURRING'],
    description:
      'IMMEDIATE (default) issues now. SCHEDULE issues once on competence_date; RECURRING issues repeatedly starting on competence_date (needs recurrence_frequency). Both create a schedule and return its id: runs happen at 09:00 America/Sao_Paulo on business days, a weekend date runs on Monday, and each note takes the competence of the day it runs. Manage schedules with the schedule_* tools.',
  },
  recurrence_frequency: {
    type: 'string',
    enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'],
    description: 'Required with emission_type RECURRING.',
  },
  recurrence_ends_on: {
    type: 'string',
    description:
      'YYYY-MM-DD, optional. Last day the recurrence may run. Without it, it runs until paused or cancelled.',
  },
  send_email: {
    type: 'boolean',
    description: 'Email the authorized invoice to the customer.',
  },
  service_code: {
    type: 'string',
    description:
      'Optional national service code (6 digits). Inherits company.defaultServiceCode when omitted, then 100901 (LC 116 item 10.09).',
  },
  municipality_code: {
    type: 'string',
    description:
      'Optional IBGE place of service (7 digits). Inherits company.municipalityCode when omitted.',
  },
  service_profile_id: {
    type: 'string',
    description: 'Optional service tax profile id (UUID).',
  },
  external_id: {
    type: 'string',
    description: 'Your own reference for this invoice.',
  },
  idempotency_key: {
    type: 'string',
    description: 'Repeat the same key to avoid issuing twice.',
  },
} as const;

export const NFSE_ISSUE_TOOL = {
  name: 'nfse_issue',
  description:
    'Emit a new NFS-e (Nota Fiscal de Serviços Eletrônica). Identify the issuing company with company_tax_id (its CNPJ) or company_id; call company_list if you do not know it. ' +
    'Minimal call: company_tax_id + amount. The customer is optional (omit it for an anonymous consumer invoice), and the competence date, service code and municipality default to today and to the company settings. ' +
    'Returns immediately with the queued status; use nfse_query to follow it. With emission_type SCHEDULE or RECURRING nothing is issued yet: it returns the schedule (schedule_id) instead.',
  inputSchema: {
    type: 'object',
    properties: NFSE_ISSUE_PROPERTIES,
    required: [],
  },
} as const;

const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
});

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function toCustomer(customer: NfseIssueInput['customer']) {
  if (!customer) return undefined;
  const { name, tax_id, email, address, foreign } = customer;
  if (!name && !tax_id && !email && !address && !foreign) return undefined;
  return {
    taxId: tax_id,
    name,
    email,
    foreign: foreign
      ? {
          taxId: foreign.tax_id,
          noTaxIdReason: foreign.no_tax_id_reason,
          country: foreign.country,
          postalCode: foreign.postal_code,
          city: foreign.city,
          region: foreign.region,
          street: foreign.street,
          number: foreign.number,
          district: foreign.district,
          complement: foreign.complement,
        }
      : undefined,
    address: address
      ? {
          street: address.street,
          city: address.city,
          state: address.state,
          zip: address.zip,
        }
      : undefined,
  };
}

function serviceAmount(params: NfseIssueInput): number {
  if (params.amount !== undefined && params.services !== undefined) {
    throw new Error('Invalid input: send either amount or services, not both');
  }
  if (params.services) {
    return roundCents(
      params.services.reduce((sum, s) => sum + s.quantity * s.unit_price, 0),
    );
  }
  return roundCents(params.amount as number);
}

function serviceDescription(params: NfseIssueInput): string | undefined {
  return params.services
    ? params.services.map((s) => s.description).join('; ')
    : params.description;
}

/**
 * Maps one snake_case tool input onto the real `CreateInvoiceDto`.
 * Throws an `Invalid input: ...` Error for problems class-validator cannot see.
 */
export function toCreateInvoiceDto(params: NfseIssueInput): CreateInvoiceDto {
  const customer = toCustomer(params.customer);
  // A customer abroad has no CPF/CNPJ; the invoice validation checks its own fields.
  if (customer && !customer.foreign && !customer.taxId?.trim()) {
    throw new Error(
      'Invalid input: customer.tax_id: required when a customer is sent; omit customer to issue without a tomador',
    );
  }

  const scheduling =
    params.emission_type === 'SCHEDULE' || params.emission_type === 'RECURRING';
  if (scheduling && !params.competence_date)
    throw new Error(
      'Invalid input: competence_date: required with SCHEDULE or RECURRING (the date of the first run, from tomorrow on)',
    );
  if (params.emission_type === 'RECURRING' && !params.recurrence_frequency)
    throw new Error(
      'Invalid input: recurrence_frequency: required when emission_type is RECURRING',
    );
  if (
    params.emission_type !== 'RECURRING' &&
    (params.recurrence_frequency || params.recurrence_ends_on)
  )
    throw new Error(
      'Invalid input: recurrence_frequency and recurrence_ends_on are only allowed when emission_type is RECURRING',
    );
  const recurrence = params.recurrence_frequency
    ? {
        frequency: params.recurrence_frequency,
        endsOn: params.recurrence_ends_on,
      }
    : undefined;

  // Map snake_case MCP input → the real camelCase CreateInvoiceDto.
  return {
    companyId: params.company_id,
    companyTaxId: params.company_tax_id,
    externalId: params.external_id,
    customer,
    service: {
      // Omitted fiscal fields are resolved from the scoped company by InvoiceService.
      code: params.service_code,
      municipalityCode: params.municipality_code,
      description: serviceDescription(params),
      serviceProfileId: params.service_profile_id,
    },
    amount: serviceAmount(params),
    discount: params.discount,
    deduction: params.deduction,
    purchaseOrder: params.purchase_order,
    notes: params.notes,
    competenceDate: params.competence_date ?? SAO_PAULO_DATE.format(new Date()),
    options:
      params.emission_type ||
      params.send_email !== undefined ||
      recurrence !== undefined
        ? {
            type: params.emission_type,
            recurrence,
            email:
              params.send_email === undefined
                ? undefined
                : { send: params.send_email },
          }
        : undefined,
  };
}

export type NfseIssueResult =
  | { invoice_id: string; access_key: string; status: string }
  | {
      schedule_id: string;
      kind: string;
      frequency: string | null;
      status: string;
      next_run_on: string | null;
      ends_on: string | null;
    };

export function createNfseIssueHandler(
  emitter: Pick<EmissionRouterService, 'emit'>,
) {
  return async function nfseIssueHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<NfseIssueResult> {
    const params = plainToInstance(
      NfseIssueInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const dto = toCreateInvoiceDto(params);

    const emitted = await emitter.emit(
      dto,
      ctx.tenantId,
      ctx,
      params.idempotency_key,
    );
    if (emitted.kind === 'schedule') {
      const schedule = emitted.schedule.props;
      return {
        schedule_id: schedule.id,
        kind: schedule.kind,
        frequency: schedule.frequency,
        status: schedule.status,
        next_run_on: schedule.nextRunOn,
        ends_on: schedule.endsOn,
      };
    }
    return {
      invoice_id: emitted.invoice.id,
      access_key: emitted.invoice.accessKey ?? '',
      status: emitted.invoice.status,
    };
  };
}
