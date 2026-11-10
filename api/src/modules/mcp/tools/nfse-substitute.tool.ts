import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceSubstitutionService } from '@/modules/invoice/application/invoice-substitution.service';
import {
  CANCELLATION_DESCRIPTION_MAX,
  CANCELLATION_DESCRIPTION_MIN,
} from '@/modules/invoice/domain/cancellation-reason';
import { NfseSubstituteInput } from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

export const NFSE_SUBSTITUTE_TOOL = {
  name: 'nfse_substitute',
  description: `Correct an authorized invoice by issuing a substitute. Only the service description, the purchase order and the notes can change: the customer, the competence date and the amount stay as issued (the tax authority refuses a substitute that changes them for MEI and Simples Nacional; to correct those, cancel the invoice and issue another). The original stays authorized until the substitute is authorized and only then becomes cancelled. The substitute uses a credit. Confirm the change with the user before calling.`,
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'UUID of the authorized invoice to substitute',
      },
      description: {
        type: 'string',
        minLength: CANCELLATION_DESCRIPTION_MIN,
        maxLength: CANCELLATION_DESCRIPTION_MAX,
        description: `Why the invoice is being substituted (${CANCELLATION_DESCRIPTION_MIN}-${CANCELLATION_DESCRIPTION_MAX} chars)`,
      },
      service_description: {
        type: 'string',
        description: 'New service description',
      },
      purchase_order: {
        type: 'string',
        maxLength: 60,
        description: 'New purchase order; an empty text removes it',
      },
      notes: {
        type: 'string',
        maxLength: 2000,
        description: 'New notes; an empty text removes them',
      },
    },
    required: ['invoice_id', 'description'],
  },
} as const;

export function createNfseSubstituteHandler(
  substitutions: Pick<InvoiceSubstitutionService, 'substitute'>,
) {
  return async function nfseSubstituteHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    invoice_id: string;
    status: string;
    substitutes_invoice_id: string | null;
  }> {
    const params = plainToInstance(
      NfseSubstituteInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const invoice = await substitutions.substitute(
      params.invoice_id,
      ctx.activeTenantId,
      executionEnvironment(ctx),
      {
        description: params.description,
        ...(params.service_description !== undefined
          ? { service: { description: params.service_description } }
          : {}),
        purchaseOrder: params.purchase_order,
        notes: params.notes,
      },
    );
    return {
      invoice_id: invoice.id,
      status: invoice.status,
      substitutes_invoice_id: invoice.substitutesInvoiceId,
    };
  };
}
