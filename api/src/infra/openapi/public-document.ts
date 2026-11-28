/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- this file reshapes an OpenAPI document, which is untyped JSON by nature */
import type { OpenAPIObject } from '@nestjs/swagger';
import { REQUIRED_PERMISSIONS_EXTENSION } from '@/modules/auth/require-permission.decorator';
import {
  NO_AUTH_OPERATION_EXTENSION,
  PUBLIC_OPERATION_EXTENSION,
} from '@/modules/auth/api-key-endpoint.decorator';
import {
  PUBLIC_OPERATIONS,
  TAGS,
  type PublicOperation,
} from './public-operations';
import { API_ERROR_CODES, COMPONENT_SCHEMAS } from './public-schemas';

export type OpenApiDocument = OpenAPIObject;

/** Version of the public contract (bump together with docs/openapi/CHANGELOG.md). */
export const PUBLIC_API_VERSION = '0.3.0';
export const PRODUCTION_SERVER = 'https://api.corvo.tech/v1';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Json = Record<string, any>;

const UUID_PARAMS = new Set([
  'id',
  'companyId',
  'certId',
  'favoriteId',
  'serviceId',
  'profileId',
]);
const SUCCESS_TEXT: Record<string, string> = {
  '200': 'OK',
  '201': 'Created',
  '202': 'Accepted: the work continues in the background',
  '204': 'No content',
};
const FAILURE_DESCRIPTIONS: Record<string, string> = {
  '400':
    'The request is malformed or failed validation (`ERROR_VALIDATION`, `ERROR_INVALID_JSON`, `ERROR_INVALID_CURSOR`, ...).',
  '401': 'The API key is missing, invalid or revoked (`ERROR_UNAUTHORIZED`).',
  '402': 'No credits left to issue (`ERROR_INSUFFICIENT_CREDITS`).',
  '403':
    'The key lacks the permission, or the resource belongs to the other environment (`ERROR_PERMISSION_DENIED`, `ERROR_TENANT_ACCESS_DENIED`, `ERROR_COMPANY_BLOCKED`).',
  '404':
    'The resource does not exist in this workspace and environment (`ERROR_NOT_FOUND` and its specific variants).',
  '409':
    'The request conflicts with the current state (`ERROR_CONFLICT` and its specific variants, `ERROR_IDEMPOTENCY_CONFLICT`).',
  '413':
    'The upload is too large (`ERROR_PAYLOAD_TOO_LARGE`, `ERROR_IMPORT_FILE_TOO_LARGE`).',
  '422':
    'A business rule refused the request (`ERROR_UNPROCESSABLE_ENTITY` and its specific variants).',
  '429':
    'Rate limit exceeded: wait `Retry-After` seconds (`ERROR_RATE_LIMIT_EXCEEDED`).',
  '500':
    'Unexpected server error (`ERROR_INTERNAL`). Safe to retry reads; quote `requestId` to support.',
  '503':
    'The service or an upstream is temporarily unavailable (`ERROR_SERVICE_UNAVAILABLE`); retry after `Retry-After`.',
};
const RATE_LIMIT_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'X-Request-Id',
];

const INFO_DESCRIPTION = `The Corvo API issues Brazilian NFS-e (nota fiscal de servico eletronica) through the national system.

## Authentication
Send your key in the \`x-api-key\` header. Keys are created in the dashboard and come in two environments:

- \`corvo_test_...\` works on the **test** environment (restricted production of the Receita): invoices have no fiscal value and use the company test certificate.
- \`corvo_live_...\` works on the **live** environment: invoices are real and each one uses a credit.

A key only sees the data of its own environment. Every route needs a permission (for example \`nfse.invoices.issue\`) that the key must carry; without it the answer is 403.

## Responses
Successful answers are wrapped: \`{ "data": ... }\`. Lists are \`{ "data": [...], "pagination": { "limit", "hasMore", "nextCursor" } }\`: pass \`nextCursor\` as \`cursor\` to get the next page. Errors are \`{ "statusCode", "code", "message", "details"?, "requestId" }\`. Fields are \`camelCase\`, except in billing, schedules and imports, which use \`snake_case\`.

## Issuing is asynchronous
\`POST /invoices\` answers 202 with the invoice queued. Follow it with \`GET /invoices/{id}\` or the invoice webhooks until \`status\` is final (\`authorized\`, \`rejected\`, \`failed\`, \`cancelled\`).

## Idempotency
Send an \`Idempotency-Key\` header on the routes that accept it. Repeating a request with the same key and body returns the first result; the same key with another body answers 409 \`ERROR_IDEMPOTENCY_CONFLICT\`.

## Rate limits
Every answer carries \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Reset\` (epoch seconds). When exceeded the API answers 429 with \`Retry-After\` (seconds).`;

function collectRefs(node: unknown, into: Set<string>) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const match = /^#\/components\/schemas\/(.+)$/.exec(value);
        if (match) into.add(match[1]);
      } else collectRefs(value, into);
    }
  }
}

/**
 * OpenAPI 3.0: `nullable: true` does not by itself let `null` through an `enum`;
 * the enum must list it. Without it a validator rejects the `null` the API sends.
 */
function allowNullInEnums(node: unknown) {
  if (Array.isArray(node)) {
    for (const item of node) allowNullInEnums(item);
  } else if (node && typeof node === 'object') {
    const record = node as Json;
    if (
      record.nullable === true &&
      Array.isArray(record.enum) &&
      !record.enum.includes(null)
    )
      record.enum = [...record.enum, null];
    // `nullable` only widens the `type` beside it: on `allOf: [$ref]` the referenced
    // object still refuses `null`. Spell the union out so every validator agrees.
    if (
      record.nullable === true &&
      Array.isArray(record.allOf) &&
      record.allOf.length === 1
    ) {
      const [inner] = record.allOf as Json[];
      delete record.nullable;
      delete record.allOf;
      delete record.type;
      record.anyOf = [inner, { type: 'object', nullable: true, enum: [null] }];
    }
    for (const value of Object.values(record)) allowNullInEnums(value);
  }
}

function rewriteRefs(node: unknown, rename: Map<string, string>) {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item, rename);
  } else if (node && typeof node === 'object') {
    const record = node as Json;
    for (const [key, value] of Object.entries(record)) {
      if (key === '$ref' && typeof value === 'string') {
        const match = /^#\/components\/schemas\/(.+)$/.exec(value);
        const to = match && rename.get(match[1]);
        if (to) record[key] = `#/components/schemas/${to}`;
      } else rewriteRefs(value, rename);
    }
  }
}

/** `FooDto` -> `Foo`, so SDK types read naturally. */
function schemaName(name: string): string {
  const special: Record<string, string> = {
    InvoiceResponseDto: 'Invoice',
    ScheduleResponseDto: 'Schedule',
    ScheduleRunResponseDto: 'ScheduleRun',
    InvoiceOverviewResponseDto: 'InvoiceOverview',
    InvoiceCalculationResponseDto: 'InvoiceCalculation',
    InvoiceBatchSummaryDto: 'InvoiceBatch',
    CustomerDto: 'InvoiceCustomer',
    ServiceDto: 'InvoiceService',
    AddressDto: 'CompanyAddress',
    RuleDto: 'IntegrationRuleInput',
    BatchInvoiceItemDto: 'InvoiceBatchItem',
    ForeignCustomerDto: 'ForeignCustomer',
  };
  return special[name] ?? name.replace(/Dto$/, '');
}

function errorBody(): Json {
  return {
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
    },
  };
}

function sharedComponents(): Json {
  const headers: Json = {
    'X-RateLimit-Limit': {
      description: 'Requests allowed in the current window.',
      schema: { type: 'integer' },
    },
    'X-RateLimit-Remaining': {
      description: 'Requests left in the current window.',
      schema: { type: 'integer' },
    },
    'X-RateLimit-Reset': {
      description: 'When the window resets, in epoch seconds.',
      schema: { type: 'integer' },
    },
    'X-Request-Id': {
      description: 'Id of the request. Quote it when you contact support.',
      schema: { type: 'string', format: 'uuid' },
    },
    'Retry-After': {
      description: 'Seconds to wait before trying again.',
      schema: { type: 'integer', minimum: 1 },
    },
  };
  const responses: Json = {};
  for (const [status, description] of Object.entries(FAILURE_DESCRIPTIONS)) {
    responses[`Error${status}`] = {
      description,
      ...(status === '429' || status === '503'
        ? {
            headers: {
              'Retry-After': { $ref: '#/components/headers/Retry-After' },
            },
          }
        : {}),
      ...errorBody(),
    };
  }
  return {
    headers,
    responses,
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description:
          'Makes the request safe to repeat: the same key with the same body returns the first result; the same key with another body answers 409 `ERROR_IDEMPOTENCY_CONFLICT`. Use a unique value per intended operation (a UUID works).',
        schema: { type: 'string', minLength: 1, maxLength: 255 },
      },
    },
  };
}

function apiErrorSchema(): Json {
  return {
    type: 'object',
    required: ['statusCode', 'code', 'message'],
    properties: {
      statusCode: { type: 'integer', example: 400 },
      error: {
        type: 'string',
        description: 'Short HTTP label, for example `Not Found`.',
      },
      code: {
        type: 'string',
        example: 'ERROR_VALIDATION',
        description:
          'Stable machine-readable code: branch on it, not on `message`. Codes start with `ERROR_` and the list can grow, so treat an unknown code as its HTTP status. A few feature codes have no prefix (`CNPJ_INVALID`, `CHECKOUT_INVALID`, `PACKAGE_TOO_LARGE`, ...); they are described on the operation.',
        'x-known-values': [...API_ERROR_CODES],
      },
      message: { type: 'string', example: 'Request validation failed' },
      type: {
        type: 'string',
        enum: ['communication', 'validation', 'configuration'],
        description:
          'Only on NF-e errors: who has to act. `validation`: fix the fields in `details`. `configuration`: complete the company or wait for the release. `communication`: the SEFAZ did not answer; Corvo retries or checks by itself.',
      },
      details: {
        description:
          'Extra data. For `ERROR_VALIDATION`: a list of `{ field, code, message }`.',
        oneOf: [
          { type: 'object', additionalProperties: true },
          {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        ],
      },
      retryable: {
        type: 'boolean',
        description: 'Present (true) on 503: the request can be repeated.',
      },
      requestId: { type: 'string', format: 'uuid' },
    },
  };
}

function normalizeParameters(
  operation: Json,
  contract: PublicOperation,
  path: string,
) {
  const params: Json[] = [];
  const dropped = new Set(contract.dropParams ?? []);
  for (const raw of [
    ...(operation.parameters ?? []),
    ...(contract.extraParams ?? []),
  ]) {
    const param = raw as Json;
    if (param.in === 'query' && dropped.has(param.name)) continue;
    if (param.in === 'header' && /^idempotency-key$/i.test(param.name))
      continue;
    const schema = { ...(param.schema ?? {}) } as Json;
    if (schema.type === 'number' && /limit$/i.test(param.name))
      schema.type = 'integer';
    if (param.in === 'path') {
      param.required = true;
      if (UUID_PARAMS.has(param.name)) schema.format = 'uuid';
      if (param.name === 'line')
        Object.assign(schema, { type: 'integer', minimum: 1 });
      if (param.name === 'taxId') {
        schema.pattern = '^\\d{11}$|^\\d{14}$';
        param.description ??=
          'CPF (11 digits) or CNPJ (14 digits) of the customer, digits only.';
      }
      if (param.name === 'cnpj')
        param.description ??=
          'The CNPJ, with or without punctuation (`12345678000195` or `12.345.678/0001-95`).';
      if (param.name !== 'taxId' && param.name !== 'cnpj')
        param.description ??= UUID_PARAMS.has(param.name)
          ? `Identifier (UUID) of the ${paramSubject(param.name, path)}.`
          : undefined;
    }
    if (param.in === 'query' && param.name === 'month') {
      param.required = true;
      schema.pattern = '^\\d{4}-(0[1-9]|1[0-2])$';
      schema.example = '2026-10';
    }
    if (param.in === 'query' && param.name === 'units') {
      param.required = true;
      Object.assign(schema, { type: 'integer', minimum: 3 });
    }
    const described = contract.paramDescriptions?.[param.name];
    if (described) param.description = described;
    if (param.description === undefined) delete param.description;
    params.push({ ...param, schema });
  }
  if (contract.idempotent)
    params.push({ $ref: '#/components/parameters/IdempotencyKey' });
  if (params.length > 0) operation.parameters = params;
  else delete operation.parameters;
}

function paramSubject(name: string, path: string): string {
  if (name === 'companyId') return 'company';
  if (name === 'certId') return 'certificate';
  if (name === 'favoriteId') return 'favorite service';
  if (name === 'serviceId') return 'service tax profile';
  if (name === 'profileId') return 'fiscal profile';
  const first = path.split('/')[1];
  const subject: Record<string, string> = {
    invoices: 'invoice',
    companies: 'company',
    schedules: 'schedule',
    imports: 'import',
    webhooks: path.includes('deliveries') ? 'delivery' : 'webhook',
    integrations: path.includes('/operations/') ? 'operation' : 'connection',
  };
  return subject[first] ?? 'resource';
}

function buildResponses(
  operation: Json,
  contract: PublicOperation,
  path: string,
  method: string,
  noAuth: boolean,
) {
  const previous = (operation.responses ?? {}) as Json;
  const responses: Json = {};
  const rateHeaders = Object.fromEntries(
    RATE_LIMIT_HEADERS.map((name) => [
      name,
      { $ref: `#/components/headers/${name}` },
    ]),
  );

  // Success responses.
  const successStatuses = Object.keys(previous).filter((s) => /^2/.test(s));
  if (contract.file) {
    const status = String(contract.file.status ?? 200);
    responses[status] = {
      description: contract.file.description,
      headers: {
        ...rateHeaders,
        'Content-Disposition': {
          description: 'Suggested file name.',
          schema: { type: 'string' },
        },
      },
      content: {
        [contract.file.contentType]: {
          schema: {
            type: 'string',
            ...(contract.file.contentType.startsWith('text/') ||
            contract.file.contentType.endsWith('xml')
              ? {}
              : { format: 'binary' }),
          },
        },
      },
    };
  } else {
    const wanted = new Set([
      ...Object.keys(contract.ok ?? {}),
      ...(contract.ok ? [] : successStatuses),
    ]);
    // A contract entry replaces the controller's success responses.
    for (const status of [...wanted].sort()) {
      const key = String(status);
      const declared = previous[key] as Json | undefined;
      const schema = contract.ok?.[Number(key)];
      const noBody = key === '204' || (!schema && !declared?.content);
      responses[key] = {
        description:
          (declared?.description as string | undefined) ||
          SUCCESS_TEXT[key] ||
          'Success',
        headers: rateHeaders,
        ...(noBody
          ? {}
          : {
              content: schema
                ? { 'application/json': { schema } }
                : declared?.content,
            }),
      };
    }
  }
  if (Object.keys(responses).length === 0) {
    const status = method === 'delete' ? '204' : '200';
    responses[status] = {
      description: SUCCESS_TEXT[status],
      headers: rateHeaders,
    };
  }

  // Error responses.
  const hasPathParams = path.includes('{');
  const hasInput =
    Boolean(operation.requestBody) ||
    (operation.parameters ?? []).some((p: Json) => p.in === 'query');
  const statuses = new Set<string>(
    noAuth ? ['429', '500'] : ['401', '403', '429', '500'],
  );
  if (hasPathParams) statuses.add('404');
  if (hasInput) statuses.add('400');
  for (const status of contract.errors ?? []) statuses.add(String(status));
  for (const status of Object.keys(previous))
    if (/^[45]/.test(status) && !isBlanket(previous[status]))
      statuses.add(status);
  for (const status of [...statuses].sort()) {
    const declared = previous[status] as Json | undefined;
    if (declared && !isBlanket(declared)) {
      responses[status] = {
        description:
          declared.description || FAILURE_DESCRIPTIONS[status] || 'Error',
        ...(status === '429' || status === '503'
          ? {
              headers: {
                'Retry-After': { $ref: '#/components/headers/Retry-After' },
              },
            }
          : {}),
        ...errorBody(),
      };
    } else if (FAILURE_DESCRIPTIONS[status]) {
      responses[status] = { $ref: `#/components/responses/Error${status}` };
    }
  }
  operation.responses = Object.fromEntries(
    Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function isBlanket(response: Json | undefined): boolean {
  return response?.description === 'Standard API error';
}

/** Keeps only the public operations and shapes the document SDK generators and readers will use. */
export function toPublicDocument(
  full: OpenApiDocument,
  apiPrefix: string,
): OpenApiDocument {
  const source = structuredClone(full) as Json;
  const paths: Json = {};
  const prefix = `/${apiPrefix}`;
  const seen = new Set<string>();
  for (const [rawPath, item] of Object.entries(source.paths as Json)) {
    const path = rawPath.startsWith(prefix)
      ? rawPath.slice(prefix.length)
      : rawPath;
    const kept: Json = {};
    for (const method of METHODS) {
      const operation = (item as Json)[method] as Json | undefined;
      if (!operation || operation[PUBLIC_OPERATION_EXTENSION] !== true)
        continue;
      const key = `${method.toUpperCase()} ${path}`;
      const contract = PUBLIC_OPERATIONS[key];
      if (!contract)
        throw new Error(
          `Public operation ${key} has no entry in public-operations.ts: add one with its operationId and response schema.`,
        );
      seen.add(key);
      const noAuth = operation[NO_AUTH_OPERATION_EXTENSION] === true;
      delete operation[PUBLIC_OPERATION_EXTENSION];
      delete operation[NO_AUTH_OPERATION_EXTENSION];
      normalizeParameters(operation, contract, path);
      buildResponses(operation, contract, path, method, noAuth);
      for (const property of contract.dropBodyProps ?? []) {
        const target = (
          operation.requestBody?.content?.['application/json']?.schema?.$ref as
            string | undefined
        )
          ?.split('/')
          .pop();
        const body = target && source.components?.schemas?.[target];
        if (body?.properties) delete body.properties[property];
        if (Array.isArray(body?.required))
          body.required = body.required.filter(
            (name: string) => name !== property,
          );
      }
      const json = operation.requestBody?.content?.['application/json'];
      if (json && contract.requestBody) json.schema = contract.requestBody;
      const multipart = operation.requestBody?.content?.['multipart/form-data'];
      if (multipart && contract.multipart)
        multipart.schema = contract.multipart;
      const permissions = operation[REQUIRED_PERMISSIONS_EXTENSION] as
        string[] | undefined;
      const description = contract.description ?? operation.description;
      kept[method] = {
        tags: [contract.tag],
        summary: contract.summary ?? operation.summary,
        ...(description || permissions
          ? {
              description: [
                description,
                permissions &&
                  `Permission: ${permissions.map((p) => `\`${p}\``).join(' or ')}.`,
              ]
                .filter(Boolean)
                .join('\n\n'),
            }
          : {}),
        ...(permissions
          ? { [REQUIRED_PERMISSIONS_EXTENSION]: permissions }
          : {}),
        operationId: contract.id,
        ...(operation.parameters ? { parameters: operation.parameters } : {}),
        ...(operation.requestBody
          ? {
              requestBody: {
                ...operation.requestBody,
                required: !contract.bodyOptional,
              },
            }
          : {}),
        responses: operation.responses,
        security: noAuth ? [] : [{ ApiKeyAuth: [] }],
      };
    }
    if (Object.keys(kept).length > 0) paths[path] = kept;
  }
  for (const key of Object.keys(PUBLIC_OPERATIONS))
    if (!seen.has(key))
      throw new Error(
        `public-operations.ts lists ${key}, but no public route matches it.`,
      );

  const components = (source.components ?? {}) as Json;
  const schemas: Json = {
    ...(components.schemas ?? {}),
    ...structuredClone(COMPONENT_SCHEMAS),
    ApiErrorDto: apiErrorSchema(),
  };
  delete schemas.ApiErrorCode;
  const shared = sharedComponents();
  const document: Json = {
    openapi: '3.0.0',
    info: {
      title: 'Corvo API',
      version: PUBLIC_API_VERSION,
      description: INFO_DESCRIPTION,
      contact: {
        name: 'Corvo',
        email: 'contato@corvo.tech',
        url: 'https://corvo.tech',
      },
      license: {
        name: 'AGPL-3.0-only',
        url: 'https://www.gnu.org/licenses/agpl-3.0.html',
      },
    },
    externalDocs: {
      description: 'Guides and examples',
      url: 'https://corvo.tech/docs',
    },
    servers: [
      { url: PRODUCTION_SERVER, description: 'Production (corvo.tech)' },
      {
        url: 'https://{host}/v1',
        description:
          'Self-hosted instance: use the public API address (`PUBLIC_API_URL`) of your installation.',
        variables: { host: { default: 'api.example.com' } },
      },
    ],
    security: [{ ApiKeyAuth: [] }],
    tags: Object.entries(TAGS).map(([name, description]) => ({
      name,
      description,
    })),
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description:
            'Your API key: `corvo_test_...` for the test environment, `corvo_live_...` for live.',
        },
      },
      headers: shared.headers,
      parameters: shared.parameters,
      responses: shared.responses,
      schemas,
    },
  };

  // Friendly schema names, then drop what no operation reaches.
  const rename = new Map<string, string>();
  const renamed: Json = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const target = schemaName(name);
    if (renamed[target]) {
      // The domain class `Invoice` has no fields: the documented one takes its name.
      if (Object.keys(renamed[target].properties ?? {}).length > 0) continue;
    }
    renamed[target] = schema;
    if (target !== name) rename.set(name, target);
  }
  rewriteRefs(document, rename);
  rewriteRefs(renamed, rename);
  const reachable = new Set<string>();
  collectRefs(document.paths, reachable);
  collectRefs(document.components.responses, reachable);
  const queue = [...reachable];
  while (queue.length) {
    const next = new Set<string>();
    collectRefs(renamed[queue.pop()!], next);
    for (const name of next)
      if (!reachable.has(name)) {
        reachable.add(name);
        queue.push(name);
      }
  }
  document.components.schemas = Object.fromEntries(
    [...reachable]
      .sort()
      .filter((name) => renamed[name])
      .map((name) => [name, renamed[name]]),
  );
  allowNullInEnums(document);
  return document as OpenApiDocument;
}
