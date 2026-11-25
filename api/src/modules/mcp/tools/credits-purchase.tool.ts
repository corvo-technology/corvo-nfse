import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, Min, validate } from 'class-validator';
import QRCode from 'qrcode';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { CheckoutRouterService } from '@/modules/billing/application/checkout-router.service';
import {
  AVULSO_MIN_UNITS,
  AVULSO_UNIT_CENTS,
} from '@/modules/credits/domain/avulso';
import { McpToolResult, type McpContent } from '../mcp.server';
import { invalidInput } from './tool-input-errors';

export const CREDITS_PURCHASE_TOOL = {
  name: 'credits_purchase',
  description:
    `Create a charge to buy avulso invoice credits (R$ ${(AVULSO_UNIT_CENTS / 100).toFixed(2)} per note, minimum ${AVULSO_MIN_UNITS} notes, they never expire). ` +
    `Unit price is ${AVULSO_UNIT_CENTS / 100} BRL: before calling, confirm the quantity and the total amount with the person. ` +
    'method "pix" returns a QR Code image, the copy-and-paste code and a payment link; method "card" returns a Stripe checkout link. ' +
    'The person always completes the payment: show the QR Code or the link, then follow it with payment_status. This tool only creates the charge.',
  inputSchema: {
    type: 'object',
    properties: {
      units: {
        type: 'integer',
        minimum: AVULSO_MIN_UNITS,
        description: `Number of invoices to buy (at least ${AVULSO_MIN_UNITS}).`,
      },
      method: {
        type: 'string',
        enum: ['pix', 'card'],
        description: 'How the person will pay.',
      },
    },
    required: ['units', 'method'],
  },
} as const;

class CreditsPurchaseInput {
  @IsInt() @Min(AVULSO_MIN_UNITS) units!: number;
  @IsIn(['pix', 'card']) method!: 'pix' | 'card';
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object' && body !== null
    ? (body as { code?: string }).code
    : undefined;
}

export function createCreditsPurchaseHandler(
  checkout: Pick<CheckoutRouterService, 'start'>,
) {
  return async function creditsPurchaseHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<McpToolResult> {
    const params = plainToInstance(
      CreditsPurchaseInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);

    const amountCents = params.units * AVULSO_UNIT_CENTS;
    const amount = BRL.format(amountCents / 100).replace(/ /g, ' ');
    let result;
    try {
      result = await checkout.start(
        ctx.activeTenantId,
        { kind: 'avulso', units: params.units, method: params.method },
        `mcp-${randomUUID()}`,
      );
    } catch (error) {
      if (errorCode(error) === 'PIX_UNAVAILABLE')
        throw new Error(
          'Pix indisponível agora. Tente com cartão (method: card).',
        );
      throw error;
    }

    if (params.method === 'card') {
      const card = result as {
        url: string;
        paymentId?: string;
        sessionId?: string;
      };
      return new McpToolResult([
        {
          type: 'text',
          text: JSON.stringify({
            payment_id: card.paymentId ?? null,
            session_id: card.sessionId ?? null,
            method: 'card',
            units: params.units,
            amount_cents: amountCents,
            amount,
            checkout_url: card.url,
            next_step:
              'Mostre o link para a pessoa pagar com cartão. Depois consulte com payment_status.',
          }),
        },
      ]);
    }

    const pix = result as {
      brCode: string | null;
      paymentLinkUrl: string;
      expiresAt: string | null;
      paymentId?: string;
    };
    const content: McpContent[] = [
      {
        type: 'text',
        text: JSON.stringify({
          payment_id: pix.paymentId ?? null,
          method: 'pix',
          units: params.units,
          amount_cents: amountCents,
          amount,
          expires_at: pix.expiresAt,
          pix_copy_paste: pix.brCode,
          payment_link_url: pix.paymentLinkUrl,
          next_step:
            'Mostre o QR Code ou o código copia-e-cola para a pessoa pagar. Depois consulte com payment_status.',
        }),
      },
    ];
    if (pix.brCode) {
      const png = await QRCode.toBuffer(pix.brCode, {
        type: 'png',
        width: 320,
      });
      content.push({
        type: 'image',
        mimeType: 'image/png',
        data: png.toString('base64'),
      });
    }
    return new McpToolResult(content);
  };
}
