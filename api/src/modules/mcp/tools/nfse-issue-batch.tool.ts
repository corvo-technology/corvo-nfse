import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { InvoiceBatchService } from '@/modules/invoice/application/invoice-batch.service';
import type { BatchItemError } from '@/modules/invoice/application/invoice-batch-error';
import { NfseIssueBatchInput, NfseIssueInput } from '../dto/tool-input.dto';
import { NFSE_ISSUE_PROPERTIES, toCreateInvoiceDto } from './nfse-issue.tool';
import { describeValidationErrors, invalidInput } from './tool-input-errors';

export const NFSE_ISSUE_BATCH_TOOL = {
  name: 'nfse_issue_batch',
  description:
    'Emit up to 50 NFS-e in one call, for one company or several. Use it for spreadsheets or any list of invoices instead of calling nfse_issue repeatedly; split longer lists into batches of 50. ' +
    'Each item takes the same fields as nfse_issue (company_tax_id or company_id, plus amount or services; customer, competence_date, service_code etc. are optional). ' +
    'ALWAYS send a stable idempotency_key per item (for example "<file>-row-<n>"): if the call times out, repeat the same batch and nothing is issued twice. ' +
    'Items are checked one by one: invalid items come back rejected with an error and are not saved, the valid ones are saved together. ' +
    'Read results by index (the item position, starting at 0), report the rejected rows with their error.message so the user can fix them, and resend only those. Accepted items are already saved: never resend them as new invoices. ' +
    'Items with replayed true were already saved by an earlier call with the same idempotency_key. Issuance is asynchronous: follow each invoice with nfse_query.',
  inputSchema: {
    type: 'object',
    properties: {
      invoices: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        description:
          'Invoices to issue (1 to 50). Each item has the same fields as nfse_issue; items may belong to different companies.',
        items: {
          type: 'object',
          properties: NFSE_ISSUE_PROPERTIES,
        },
      },
    },
    required: ['invoices'],
  },
} as const;

type BatchToolResult = {
  index: number;
  status: 'accepted' | 'rejected';
  replayed?: true;
  invoice_id?: string;
  access_key?: string;
  invoice_status?: string;
  error?: BatchItemError;
};

export function createNfseIssueBatchHandler(batchService: InvoiceBatchService) {
  return async function nfseIssueBatchHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    total: number;
    accepted: number;
    rejected: number;
    results: BatchToolResult[];
  }> {
    const input = plainToInstance(
      NfseIssueBatchInput,
      rawParams as Record<string, unknown>,
    );
    const inputErrors = await validate(input);
    if (inputErrors.length > 0) throw invalidInput(inputErrors);

    const results = new Array<BatchToolResult>(input.invoices.length);
    const toSend: unknown[] = [];
    const sentIndexes: number[] = [];
    for (const [index, raw] of input.invoices.entries()) {
      const mapped = await mapItem(raw);
      if ('error' in mapped) {
        results[index] = { index, status: 'rejected', error: mapped.error };
        continue;
      }
      toSend.push(mapped.dto);
      sentIndexes.push(index);
    }

    if (toSend.length > 0) {
      const outcome = await batchService.emitBatch(toSend, ctx.tenantId, ctx);
      for (const item of outcome.results) {
        const index = sentIndexes[item.index];
        results[index] =
          item.status === 'accepted'
            ? {
                index,
                status: 'accepted',
                ...(item.replayed ? { replayed: true as const } : {}),
                invoice_id: item.invoice.id,
                access_key: item.invoice.accessKey ?? '',
                invoice_status: item.invoice.status,
              }
            : { index, status: 'rejected', error: item.error };
      }
    }

    const accepted = results.filter((r) => r.status === 'accepted').length;
    return {
      total: results.length,
      accepted,
      rejected: results.length - accepted,
      results,
    };
  };
}

async function mapItem(
  raw: unknown,
): Promise<{ dto: unknown } | { error: BatchItemError }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return {
      error: {
        code: 'ERROR_VALIDATION',
        message: 'Each item must be an object',
      },
    };
  const params = plainToInstance(
    NfseIssueInput,
    raw as Record<string, unknown>,
  );
  const errors = await validate(params);
  if (errors.length > 0)
    return {
      error: {
        code: 'ERROR_VALIDATION',
        message: describeValidationErrors(errors).join('; '),
      },
    };
  try {
    return {
      dto: {
        ...toCreateInvoiceDto(params),
        idempotencyKey: params.idempotency_key,
      },
    };
  } catch (error) {
    return {
      error: {
        code: 'ERROR_VALIDATION',
        message: (error as Error).message.replace(/^Invalid input: /, ''),
      },
    };
  }
}
