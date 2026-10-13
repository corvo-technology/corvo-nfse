import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import { NfseIssueInput } from '../dto/tool-input.dto';

export const NFSE_ISSUE_TOOL = {
  name: 'nfse_issue',
  description:
    'Emit a new NFS-e (Nota Fiscal de Serviços Eletrônica) invoice for a company. Returns immediately with queued status.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: {
        type: 'string',
        description: 'UUID of the company emitting the invoice',
      },
      customer: {
        type: 'object',
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
        required: ['name', 'tax_id'],
      },
      services: {
        type: 'array',
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
      competence_date: {
        type: 'string',
        description: 'ISO date string YYYY-MM-DD',
      },
      service_code: {
        type: 'string',
        description:
          'Optional national service code (6 digits). Inherits company.defaultServiceCode when omitted.',
      },
      municipality_code: {
        type: 'string',
        description:
          'Optional IBGE place of service (7 digits). Inherits company.municipalityCode when omitted.',
      },
      idempotency_key: { type: 'string' },
    },
    required: ['company_id', 'customer', 'services', 'competence_date'],
  },
} as const;

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
    if (errors.length > 0) {
      const bad = errors.map((e) => e.property).join(', ');
      throw new Error(`Invalid input: ${bad}`);
    }

    // amount is taken directly by CreateInvoiceDto (it does not compute it), so
    // derive it here from the line items.
    const amount = params.services.reduce(
      (sum, s) => sum + s.quantity * s.unit_price,
      0,
    );

    // Map snake_case MCP input → the real camelCase CreateInvoiceDto.
    const dto: CreateInvoiceDto = {
      companyId: params.company_id,
      customer: {
        taxId: params.customer.tax_id,
        name: params.customer.name,
        email: params.customer.email,
        address: params.customer.address
          ? {
              street: params.customer.address.street,
              city: params.customer.address.city,
              state: params.customer.address.state,
              zip: params.customer.address.zip,
            }
          : undefined,
      },
      service: {
        // Omitted fiscal fields are resolved from the scoped company by InvoiceService.
        code: params.service_code,
        municipalityCode: params.municipality_code,
        // Real ServiceDto has a single `description`; fold the line items into it.
        description: params.services.map((s) => s.description).join('; '),
      },
      amount,
      competenceDate: params.competence_date,
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
