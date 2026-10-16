import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import { NfseIssueInput } from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

export const NFSE_ISSUE_TOOL = {
  name: 'nfse_issue',
  description:
    'Emit a new NFS-e (Nota Fiscal de Serviços Eletrônica). Identify the issuing company with company_tax_id (its CNPJ) or company_id; call company_list if you do not know it. ' +
    'Minimal call: company_tax_id + amount. The customer is optional (omit it for an anonymous consumer invoice), and the competence date, service code and municipality default to today and to the company settings. ' +
    'Returns immediately with the queued status; use nfse_query to follow it.',
  inputSchema: {
    type: 'object',
    properties: {
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
        description:
          'Unconditional discount in BRL (>= 0, at most the amount).',
      },
      competence_date: {
        type: 'string',
        description:
          'YYYY-MM-DD. Defaults to today (America/Sao_Paulo). A future date needs emission_type SCHEDULE.',
      },
      emission_type: {
        type: 'string',
        enum: ['IMMEDIATE', 'SCHEDULE'],
        description:
          'IMMEDIATE (default) or SCHEDULE: release the invoice on a future competence_date.',
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
    },
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
  const { name, tax_id, email, address } = customer;
  if (!name && !tax_id && !email && !address) return undefined;
  return {
    taxId: tax_id,
    name,
    email,
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

export function createNfseIssueHandler(invoiceService: InvoiceService) {
  return async function nfseIssueHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{ invoice_id: string; access_key: string; status: string }> {
    const params = plainToInstance(
      NfseIssueInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const customer = toCustomer(params.customer);
    if (customer && !customer.taxId?.trim()) {
      throw new Error(
        'Invalid input: customer.tax_id: required when a customer is sent; omit customer to issue without a tomador',
      );
    }

    // Map snake_case MCP input → the real camelCase CreateInvoiceDto.
    const dto: CreateInvoiceDto = {
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
      competenceDate:
        params.competence_date ?? SAO_PAULO_DATE.format(new Date()),
      options:
        params.emission_type || params.send_email !== undefined
          ? {
              type: params.emission_type,
              email:
                params.send_email === undefined
                  ? undefined
                  : { send: params.send_email },
            }
          : undefined,
    };

    const invoice = await invoiceService.emit(
      dto,
      ctx.tenantId,
      ctx,
      params.idempotency_key,
    );
    return {
      invoice_id: invoice.id,
      access_key: invoice.accessKey ?? '',
      status: invoice.status,
    };
  };
}
