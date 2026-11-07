import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { ImportEmitService } from '@/modules/import/application/import-emit.service';
import type { ImportIntakeService } from '@/modules/import/application/import-intake.service';
import type { ImportReviewService } from '@/modules/import/application/import-review.service';
import {
  toImportResponse,
  toRowResponse,
  toStartResponse,
} from '@/modules/import/http/import.response';
import {
  ImportCreateInput,
  ImportFixRowInput,
  ImportIdInput,
  ImportListInput,
  ImportRowsInput,
} from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

/** A spreadsheet sent through the assistant is text inside a message: bigger files go through the API upload. */
export const MCP_IMPORT_MAX_BYTES = 1024 * 1024;

const IMPORT_ID = {
  import_id: { type: 'string', description: 'UUID of the import' },
} as const;

export const IMPORT_CREATE_TOOL = {
  name: 'import_create',
  description:
    'Start an import of invoices from a spreadsheet. Send the file as text: `content` with the CSV (header in the first line, columns such as cnpj_prestador, tomador_documento, tomador_nome, tomador_email, descricao, valor, codigo_servico, data_competencia), or `content_base64` with an .xlsx. Up to 2,000 rows and 1 MB here (bigger files: POST /v1/imports). Reading is asynchronous: poll import_get until status is "ready", review with import_rows, then call import_emit. The issuing company comes from the CNPJ column or from `company_id`.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The CSV text' },
      content_base64: {
        type: 'string',
        description:
          'An .xlsx file encoded in base64 (CSV in `content` is preferred)',
      },
      file_name: {
        type: 'string',
        description:
          'Defaults to import.csv, or import.xlsx with content_base64',
      },
      company_id: {
        type: 'string',
        description: 'UUID of the company that issues rows without a CNPJ',
      },
    },
    required: [],
  },
} as const;

export const IMPORT_LIST_TOOL = {
  name: 'import_list',
  description:
    'List the recent imports in the connected environment, newest first, with their counters. Use it to find an import again, for example one waiting for credits.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '1 to 20, default 10' },
    },
    required: [],
  },
} as const;

export const IMPORT_GET_TOOL = {
  name: 'import_get',
  description:
    'Status and counters of an import: processing, ready (to review), emitting, done or failed. Counters: total, valid, invalid, accepted, authorized, awaiting_credits (turned away for lack of credits, not errors), failed, pending, and valid_amount in BRL. While processing, rows_expected tells how many rows the file has.',
  inputSchema: {
    type: 'object',
    properties: IMPORT_ID,
    required: ['import_id'],
  },
} as const;

export const IMPORT_ROWS_TOOL = {
  name: 'import_rows',
  description:
    'Rows of an import, one page at a time (at most 200). Filter with status valid, invalid, queued, accepted or rejected; "invalid" lists the rows with problems and the reason. Pass next_cursor to get the next page.',
  inputSchema: {
    type: 'object',
    properties: {
      ...IMPORT_ID,
      status: {
        type: 'string',
        enum: ['valid', 'invalid', 'queued', 'accepted', 'rejected'],
      },
      cursor: {
        type: 'string',
        description: 'next_cursor of the previous page',
      },
      limit: { type: 'number', description: '1 to 200, default 50' },
    },
    required: ['import_id'],
  },
} as const;

export const IMPORT_FIX_ROW_TOOL = {
  name: 'import_fix_row',
  description:
    'Correct one row of an import that is ready, and check it again. Send the invoice fields that change in `item` (amount, competenceDate, customer {name, taxId, email}, service {description, code}); customer and service are merged field by field, so sending only the e-mail keeps the name. The company of a row (companyId, companyTaxId) cannot be changed. Returns the row, valid or still invalid with the reason.',
  inputSchema: {
    type: 'object',
    properties: {
      ...IMPORT_ID,
      line: {
        type: 'number',
        description: 'Line of the row (as in import_rows)',
      },
      item: { type: 'object', description: 'Invoice fields to change' },
    },
    required: ['import_id', 'line', 'item'],
  },
} as const;

export const IMPORT_EMIT_TOOL = {
  name: 'import_emit',
  description:
    'Issue every valid row of the import, in chunks. Safe to call twice. If credits ran out, rows are left awaiting_credits: top up, then call import_emit again and only those rows are sent. Follow progress with import_get.',
  inputSchema: {
    type: 'object',
    properties: IMPORT_ID,
    required: ['import_id'],
  },
} as const;

export const IMPORT_DISCARD_TOOL = {
  name: 'import_discard',
  description:
    'Discard an import that has not been emitted yet. Nothing is issued. Not possible once emitting or done.',
  inputSchema: {
    type: 'object',
    properties: IMPORT_ID,
    required: ['import_id'],
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

export function createImportCreateHandler(intake: ImportIntakeService) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ImportCreateInput, raw);
    if ((p.content === undefined) === (p.content_base64 === undefined))
      throw new Error(
        'Invalid input: send exactly one of content or content_base64',
      );
    const bytes =
      p.content !== undefined
        ? Buffer.from(p.content, 'utf8')
        : Buffer.from(p.content_base64!, 'base64');
    if (bytes.length > MCP_IMPORT_MAX_BYTES)
      throw new Error(
        'Invalid input: the spreadsheet is over 1 MB. Use the API upload (POST /v1/imports) for bigger files',
      );
    return toStartResponse(
      await intake.start({
        tenantId: ctx.tenantId,
        environment: executionEnvironment(ctx),
        userId: ctx.authUserId,
        fileName:
          p.file_name ??
          (p.content !== undefined ? 'import.csv' : 'import.xlsx'),
        bytes,
        companyId: p.company_id,
      }),
    );
  };
}

export function createImportListHandler(review: ImportReviewService) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ImportListInput, raw);
    const views = await review.list(
      ctx.tenantId,
      executionEnvironment(ctx),
      p.limit ?? 10,
    );
    return { imports: views.map(toImportResponse) };
  };
}

export function createImportGetHandler(review: ImportReviewService) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ImportIdInput, raw);
    return toImportResponse(
      await review.get(ctx.tenantId, executionEnvironment(ctx), p.import_id),
    );
  };
}

export function createImportRowsHandler(review: ImportReviewService) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ImportRowsInput, raw);
    const page = await review.listRows(
      ctx.tenantId,
      executionEnvironment(ctx),
      p.import_id,
      { status: p.status, cursor: p.cursor, limit: p.limit ?? 50 },
    );
    return {
      rows: page.items.map(toRowResponse),
      next_cursor: page.nextCursor,
      has_more: page.nextCursor !== null,
    };
  };
}

export function createImportFixRowHandler(review: ImportReviewService) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ImportFixRowInput, raw);
    return toRowResponse(
      await review.updateRow(
        ctx.tenantId,
        executionEnvironment(ctx),
        p.import_id,
        p.line,
        p.item,
      ),
    );
  };
}

export function createImportEmitHandler(emitter: ImportEmitService) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ImportIdInput, raw);
    return toImportResponse(
      await emitter.emit(ctx.tenantId, executionEnvironment(ctx), p.import_id),
    );
  };
}

export function createImportDiscardHandler(review: ImportReviewService) {
  return async (raw: unknown, ctx: AuthContext) => {
    const p = await parse(ImportIdInput, raw);
    await review.discard(ctx.tenantId, executionEnvironment(ctx), p.import_id);
    return { import_id: p.import_id, discarded: true };
  };
}
