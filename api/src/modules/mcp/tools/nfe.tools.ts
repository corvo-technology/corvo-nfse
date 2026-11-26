import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  validate,
} from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { NfeSettingsView } from '@/modules/company/application/company-nfe-settings.service';
import { McpNfe } from './nfe-access';
import { toDetailedNfe, toPublicNfe } from './public-shapes';
import { invalidInput } from './tool-input-errors';

type Handler = (params: unknown, ctx: AuthContext) => Promise<unknown>;

export const INVOICE_TYPES = ['nfse', 'nfe'] as const;
export type McpInvoiceType = (typeof INVOICE_TYPES)[number];

/** The `type` property the shared tools got: absent means NFS-e, as before. */
export const TYPE_PROPERTY = {
  type: 'string',
  enum: [...INVOICE_TYPES],
  default: 'nfse',
  description:
    'Kind of invoice: "nfse" (default, services) or "nfe" (goods, model 55, homologação only; needs NF-e released for the account). With "nfe" use invoice_id, not access_key.',
} as const;

export const TYPE_ALL_PROPERTY = {
  ...TYPE_PROPERTY,
  enum: [...INVOICE_TYPES, 'all'],
  description:
    'Kind of invoice: "nfse" (default), "nfe" (goods, homologação only) or "all" (NFS-e and NF-e together, newest first; NF-e only when released). With "nfe" or "all" only status, company_id, limit and cursor filters apply.',
} as const;

const NFE_BODY_DESCRIPTION =
  'The NF-e as in POST /v1/invoices (camelCase, without companyId and type): recipient {taxId, name, indIeDest, stateRegistration?, email?, address{street, number, district, zip, cityCode, city, state}}, items[] {code, description, ncm, cfop, unit, quantity, unitPrice, tax? {csosn}}, payments[] {tPag, amount}, natOp?, change?, additionalInfo?. The customer informs CFOP, NCM and CSOSN: Corvo does not calculate taxes. Phase 1: homologação only, Simples Nacional (CSOSN 102 or 400).';

export const NFE_PROPERTY = {
  type: 'object',
  description: NFE_BODY_DESCRIPTION,
} as const;

/** Reads `type`; anything else than the allowed values is an input error. */
export function typeOf(
  raw: unknown,
  allowed: readonly string[] = INVOICE_TYPES,
): string {
  const type = (raw as { type?: unknown } | null | undefined)?.type;
  if (type === undefined || type === null) return 'nfse';
  if (typeof type !== 'string' || !allowed.includes(type))
    throw new Error(`Invalid input: type must be one of ${allowed.join(', ')}`);
  return type;
}

/**
 * One handler that sends the call to the NF-e side when `type` says so and keeps the NFS-e handler
 * (and its behaviour) for everything else.
 */
export function byType(
  nfse: Handler,
  other: Record<string, Handler>,
  allowed: readonly string[] = INVOICE_TYPES,
): Handler {
  return async (raw, ctx) => {
    const type = typeOf(raw, allowed);
    const handler = other[type];
    return handler ? handler(raw, ctx) : nfse(raw, ctx);
  };
}

async function parse<T extends object>(
  cls: new () => T,
  raw: unknown,
): Promise<T> {
  const params = plainToInstance(cls, (raw ?? {}) as Record<string, unknown>);
  const errors = await validate(params);
  if (errors.length > 0) throw invalidInput(errors);
  return params;
}

const noResponse = { status: () => undefined, setHeader: () => undefined };

// --- inputs ------------------------------------------------------------------------------------

class CompanyInput {
  @IsUUID() company_id!: string;
}

class NfeIssueInput extends CompanyInput {
  @IsObject() nfe!: Record<string, unknown>;
  @IsString() @MinLength(1) @MaxLength(255) idempotency_key!: string;
  @IsOptional() @IsString() @MaxLength(255) external_id?: string;
  @IsOptional() @IsBoolean() send_email?: boolean;
}

class NfeValidateInput extends CompanyInput {
  @IsObject() nfe!: Record<string, unknown>;
}

class NfeIdInput {
  @IsUUID() invoice_id!: string;
}

class NfeListInput {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(1000) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}

class NfeCancelInput extends NfeIdInput {
  @IsString() @MaxLength(2000) description!: string;
}

class NfeCorrectInput extends NfeIdInput {
  @IsString() @MaxLength(5000) correction!: string;
}

class NfeDownloadInput extends NfeIdInput {
  @IsOptional() @IsIn(['pdf', 'xml']) format?: 'pdf' | 'xml';
  @IsOptional() @IsBoolean() inline?: boolean;
}

class NfeReviewInput extends NfeIdInput {
  @IsIn(['retry', 'discard']) action!: 'retry' | 'discard';
}

class NfeInutilizeInput extends CompanyInput {
  @IsInt() @Min(0) @Max(999) series!: number;
  @IsInt() @Min(1) @Max(999999999) start!: number;
  @IsInt() @Min(1) @Max(999999999) end!: number;
  @IsString() @MaxLength(2000) justification!: string;
  @IsOptional() @IsString() @MaxLength(255) idempotency_key?: string;
}

class NfeGapsInput {
  @IsOptional() @IsUUID() company_id?: string;
}

class NfeSettingsUpdateInput extends CompanyInput {
  @IsString() @MinLength(8) @MaxLength(18) state_registration!: string;
  @IsOptional() @IsIn([1, 4]) crt?: 1 | 4;
  @IsOptional() @IsInt() @Min(0) @Max(999) default_series?: number;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  default_nat_op?: string;
  @IsOptional() @IsIn(['102', '400']) default_csosn?: '102' | '400';
  @IsOptional() @IsInt() @Min(0) @Max(8) default_origin?: number;
}

// --- NF-e side of the shared tools (type "nfe") ------------------------------------------------

type Accepted = { id: string; status: string; replayed?: true };

export function createNfeIssueHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeIssueInput, raw);
    const body = {
      ...params.nfe,
      companyId: params.company_id,
      ...(params.external_id ? { externalId: params.external_id } : {}),
      ...(params.send_email !== undefined
        ? { sendEmail: params.send_email }
        : {}),
    };
    const result = await nfe.run<Accepted>(
      ctx,
      'nfe.documents.issue',
      (routes, call) =>
        routes.create(body, params.idempotency_key, call, noResponse),
    );
    return {
      type: 'nfe',
      invoice_id: result.id,
      status: result.status,
      ...(result.replayed ? { replayed: true } : {}),
    };
  };
}

export function createNfeGetHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeIdInput, raw);
    const invoice = await nfe.run(ctx, 'nfe.documents.view', (r, c) =>
      r.get(params.invoice_id, c),
    );
    const events = await nfe.run(ctx, 'nfe.documents.view', (r, c) =>
      r.events(params.invoice_id, c),
    );
    return { invoice: toDetailedNfe(invoice), events };
  };
}

type Page = {
  data: unknown[];
  pagination: { nextCursor: string | null };
};

export function createNfeListHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeListInput, raw);
    const page = await nfe.run<Page>(ctx, 'nfe.documents.view', (r, c) =>
      r.list(
        {
          limit: params.limit ?? 50,
          cursor: params.cursor,
          companyId: params.company_id,
          status: params.status,
        },
        c,
      ),
    );
    return {
      invoices: page.data.map(toPublicNfe),
      next_cursor: page.pagination.nextCursor,
    };
  };
}

/** `type: "all"`: NFS-e and NF-e in one list; falls back to the NFS-e list when NF-e is not for this member. */
export function createAllListHandler(nfe: McpNfe, nfse: Handler): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeListInput, raw);
    const page = await nfe.summaries(ctx, {
      companyId: params.company_id,
      status: params.status,
      limit: params.limit ?? 50,
      cursor: params.cursor,
    });
    if (!page) return nfse({ ...(raw as object), type: undefined }, ctx);
    return {
      invoices: page.data.map((item) => ({
        type: item.type,
        id: item.id,
        companyId: item.companyId,
        status: item.status,
        number: item.number,
        accessKey: item.accessKey,
        amount: item.amount,
        externalId: item.externalId,
        issuedAt: item.issuedAt,
        createdAt: item.createdAt,
      })),
      next_cursor: page.pagination.nextCursor,
    };
  };
}

export function createNfeCancelHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeCancelInput, raw);
    const doc = await nfe.run<{ id: string; status: string }>(
      ctx,
      'nfe.documents.manage',
      (r, c) =>
        r.cancel(params.invoice_id, { justification: params.description }, c),
    );
    return { type: 'nfe', invoice_id: doc.id, status: doc.status };
  };
}

type Download = {
  downloadUrl: string;
  expiresAt: string;
  fileName: string;
  mimeType: string;
};

async function nfeDownload(
  nfe: McpNfe,
  ctx: AuthContext,
  id: string,
  format: 'pdf' | 'xml',
) {
  const file = await nfe.run<Download>(ctx, 'nfe.documents.view', (r, c) =>
    r.downloadUrl(id, format, c, noResponse as never),
  );
  return {
    type: 'nfe',
    invoice_id: id,
    format,
    download_url: file.downloadUrl,
    expires_at: file.expiresAt,
    file_name: file.fileName,
    mime_type: file.mimeType,
  };
}

export function createNfeDownloadPdfHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeDownloadInput, raw);
    if (params.inline === true)
      throw new Error(
        'inline is not available for NF-e: use the download link (nfse_get_download_url with type "nfe")',
      );
    return nfeDownload(nfe, ctx, params.invoice_id, 'pdf');
  };
}

export function createNfeGetDownloadUrlHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeDownloadInput, raw);
    return nfeDownload(nfe, ctx, params.invoice_id, params.format ?? 'pdf');
  };
}

/** `nfse_review` for an NF-e: "retry" asks the SEFAZ by the access key, "discard" drops a rejected one. */
export function createNfeReviewHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeReviewInput, raw);
    const doc = await nfe.run<{ id: string; status: string }>(
      ctx,
      'nfe.documents.manage',
      (r, c) =>
        params.action === 'retry'
          ? r.sync(params.invoice_id, c)
          : r.discard(params.invoice_id, c),
    );
    return {
      type: 'nfe',
      invoice_id: doc.id,
      action: params.action,
      outcome: 'accepted',
      status: doc.status,
    };
  };
}

// --- tools that only exist for NF-e ------------------------------------------------------------

export const NFE_VALIDATE_TOOL = {
  name: 'nfe_validate',
  description:
    'Dry-run of an NF-e: checks the data and returns the problems field by field (issues), without numbering, sending or charging anything. Always run it before nfse_issue with type "nfe". NF-e must be released for the account (homologação only).',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: {
        type: 'string',
        description: 'UUID of the issuing company (company_list).',
      },
      nfe: NFE_PROPERTY,
    },
    required: ['company_id', 'nfe'],
  },
} as const;

export const NFE_CORRECT_TOOL = {
  name: 'nfe_correct',
  description:
    'Send a correction letter (CC-e) for an authorized NF-e. It cannot change values, taxes, the parties or the dates. 15 to 1000 characters. Follow the result with nfse_get and type "nfe" (events).',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: { type: 'string', description: 'UUID of the NF-e' },
      correction: {
        type: 'string',
        minLength: 15,
        maxLength: 1000,
        description: 'The correction text.',
      },
    },
    required: ['invoice_id', 'correction'],
  },
} as const;

export const NFE_INUTILIZE_TOOL = {
  name: 'nfe_inutilize',
  description:
    'Inutilize a range of NF-e numbers that will never be used (for example the gaps from nfe_number_gaps). Ask the person to confirm first: it cannot be undone. Justification of 15 to 255 characters.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: {
        type: 'string',
        description: 'UUID of the issuing company',
      },
      series: { type: 'number', minimum: 0, maximum: 999 },
      start: { type: 'number', minimum: 1 },
      end: { type: 'number', minimum: 1 },
      justification: { type: 'string', minLength: 15, maxLength: 255 },
      idempotency_key: {
        type: 'string',
        description: 'Repeat the same key to avoid doing it twice.',
      },
    },
    required: ['company_id', 'series', 'start', 'end', 'justification'],
  },
} as const;

export const NFE_NUMBER_GAPS_TOOL = {
  name: 'nfe_number_gaps',
  description:
    'List the skipped NF-e numbers (gaps) per company and series. Use nfe_inutilize to close a gap the person confirms will never be used.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: {
        type: 'string',
        description: 'Only this company (UUID). Omit for all.',
      },
    },
  },
} as const;

export const NFE_SETTINGS_GET_TOOL = {
  name: 'nfe_settings_get',
  description:
    'NF-e settings of a company (state registration, CRT, default series, nature of operation and tax defaults) and what is still missing (missing) before it can issue an NF-e.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'string', description: 'UUID of the company' },
    },
    required: ['company_id'],
  },
} as const;

export const NFE_SETTINGS_UPDATE_TOOL = {
  name: 'nfe_settings_update',
  description:
    'Set the NF-e settings of a company: state registration (IE, validated for the state of the company) plus optional defaults. The CRT follows the tax regime of the company (Simples Nacional 1, MEI 4); send `crt` only to override it. Returns the settings and what is still missing.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'string', description: 'UUID of the company' },
      state_registration: { type: 'string', description: 'IE, digits' },
      crt: { type: 'number', enum: [1, 4] },
      default_series: { type: 'number', minimum: 0, maximum: 999 },
      default_nat_op: { type: 'string', maxLength: 60 },
      default_csosn: { type: 'string', enum: ['102', '400'] },
      default_origin: { type: 'number', minimum: 0, maximum: 8 },
    },
    required: ['company_id', 'state_registration'],
  },
} as const;

/** The tools only people with NF-e released see in `tools/list`. */
export const NFE_ONLY_TOOL_NAMES = [
  NFE_VALIDATE_TOOL.name,
  NFE_CORRECT_TOOL.name,
  NFE_INUTILIZE_TOOL.name,
  NFE_NUMBER_GAPS_TOOL.name,
  NFE_SETTINGS_GET_TOOL.name,
  NFE_SETTINGS_UPDATE_TOOL.name,
] as const;

export function createNfeValidateHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeValidateInput, raw);
    // The XML never goes to the agent: issues and the numbers only.
    const result = await nfe.run<Record<string, unknown>>(
      ctx,
      'nfe.documents.issue',
      (r, c) =>
        r.validate({ ...params.nfe, companyId: params.company_id }, false, c),
    );
    const { xml: _xml, ...safe } = result;
    return safe;
  };
}

export function createNfeCorrectHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeCorrectInput, raw);
    return nfe.run(ctx, 'nfe.documents.manage', (r, c) =>
      r.correct(params.invoice_id, { correction: params.correction }, c),
    );
  };
}

export function createNfeInutilizeHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeInutilizeInput, raw);
    return nfe.run(ctx, 'nfe.documents.manage', (r, c) =>
      r.createInutilization(
        {
          companyId: params.company_id,
          series: params.series,
          start: params.start,
          end: params.end,
          justification: params.justification,
        },
        params.idempotency_key,
        c,
        noResponse,
      ),
    );
  };
}

export function createNfeNumberGapsHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeGapsInput, raw);
    const gaps = await nfe.run<unknown[]>(ctx, 'nfe.documents.view', (r, c) =>
      r.numberGaps({ companyId: params.company_id }, c),
    );
    return { gaps };
  };
}

export function createNfeSettingsGetHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(CompanyInput, raw);
    return nfe.withSettings(
      ctx,
      'nfe.documents.view',
      (settings): Promise<NfeSettingsView> =>
        settings.get(
          params.company_id,
          ctx.activeTenantId,
          executionEnvironment(ctx),
        ),
    );
  };
}

export function createNfeSettingsUpdateHandler(nfe: McpNfe): Handler {
  return async (raw, ctx) => {
    const params = await parse(NfeSettingsUpdateInput, raw);
    return nfe.withSettings(ctx, 'nfe.documents.manage', (settings) =>
      settings.update(
        params.company_id,
        ctx.activeTenantId,
        executionEnvironment(ctx),
        {
          stateRegistration: params.state_registration,
          crt: params.crt,
          defaultSeries: params.default_series,
          defaultNatOp: params.default_nat_op,
          defaultCsosn: params.default_csosn,
          defaultOrigin: params.default_origin,
        },
      ),
    );
  };
}
