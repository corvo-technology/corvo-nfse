import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsUUID,
  MaxLength,
  validate,
} from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { TYPE_PROPERTY } from './nfe.tools';
import { invalidInput } from './tool-input-errors';

export class NfseEmailResendInput {
  @IsUUID() invoice_id!: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
}

export const NFSE_EMAIL_RESEND_TOOL = {
  name: 'nfse_email_resend',
  description:
    'Resend an authorized NFS-e, NF-e or NFC-e (PDF and XML) by email. By default it goes to the customer email on the invoice; pass email to send to another address. Fails when the invoice is not authorized yet, is cancelled, or has no customer email and none is given. Confirm the destination with the user before calling.',
  inputSchema: {
    type: 'object',
    properties: {
      type: TYPE_PROPERTY,
      invoice_id: {
        type: 'string',
        description: 'UUID of the authorized invoice',
      },
      email: {
        type: 'string',
        maxLength: 254,
        description:
          'Optional destination address, instead of the customer email on the invoice',
      },
    },
    required: ['invoice_id'],
  },
} as const;

export function createNfseEmailResendHandler(
  invoiceService: Pick<InvoiceService, 'requestEmail'>,
) {
  return async function nfseEmailResendHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{ invoice_id: string; email_id: string; status: string }> {
    const params = plainToInstance(
      NfseEmailResendInput,
      rawParams as Record<string, unknown>,
    );
    if (typeof params.email === 'string') params.email = params.email.trim();
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const result = await invoiceService.requestEmail(
      params.invoice_id,
      ctx.activeTenantId,
      undefined,
      executionEnvironment(ctx),
      params.email,
    );
    return {
      invoice_id: params.invoice_id,
      email_id: result.emailId,
      status: result.status,
    };
  };
}
