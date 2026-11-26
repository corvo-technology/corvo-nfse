/* eslint-disable @typescript-eslint/no-unsafe-member-access -- an OpenAPI document is untyped JSON */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

type Json = Record<string, any>;

const document = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'docs', 'openapi', 'openapi.json'),
    'utf8',
  ),
) as Json;

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const compiled = new Map<string, ValidateFunction>();

/** The documented operation of a route: `METHOD /path` (without `/v1`), as in the document. */
export function documentedOperation(key: string): Json {
  const [method, path] = key.split(' ');
  const operation = document.paths[path]?.[method.toLowerCase()] as
    Json | undefined;
  if (!operation)
    throw new Error(`"${key}" is not in docs/openapi/openapi.json`);
  // Shared error responses are `$ref`s to `#/components/responses/*`: resolve them.
  const responses = Object.fromEntries(
    Object.entries((operation.responses ?? {}) as Json).map(
      ([status, response]: [string, Json]) => [
        status,
        typeof response.$ref === 'string'
          ? (document.components.responses[
              response.$ref.replace('#/components/responses/', '')
            ] as Json)
          : response,
      ],
    ),
  );
  return { ...operation, responses };
}

/** Every `METHOD /path` the document publishes. */
export function allOperations(): string[] {
  return Object.entries(document.paths as Json).flatMap(([path, item]) =>
    ['get', 'post', 'put', 'patch', 'delete']
      .filter((method) => item[method])
      .map((method) => `${method.toUpperCase()} ${path}`),
  );
}

function validator(key: string, status: number, mediaType: string) {
  const id = `${key} ${status} ${mediaType}`;
  let validate = compiled.get(id);
  if (!validate) {
    const schema = documentedOperation(key).responses[String(status)].content[
      mediaType
    ].schema as Json;
    // `$ref`s point at `#/components/schemas/...` of the same document.
    validate = ajv.compile({ ...schema, components: document.components });
    compiled.set(id, validate);
  }
  return validate;
}

export interface RealResponse {
  status: number;
  /** The `Content-Type` header, parameters included. */
  contentType: string;
  /** The parsed JSON body, or the raw text/buffer for non-JSON answers. */
  body: unknown;
  /** The raw bytes as text, to tell an empty body from `null`. */
  text: string;
}

/**
 * Checks a real response against the published contract: the status is one the
 * operation documents, the media type is the documented one and a JSON body
 * satisfies the documented schema. Returns the problems found (empty: it conforms).
 */
export function contractProblems(
  key: string,
  response: RealResponse,
): string[] {
  const documented = documentedOperation(key).responses as Json;
  const declared = documented[String(response.status)] as Json | undefined;
  if (!declared)
    return [
      `${key}: answered ${response.status}, documented: ${Object.keys(
        documented,
      )
        .filter((status) => status.startsWith('2'))
        .join(', ')}`,
    ];
  const content = declared.content as Json | undefined;
  if (!content)
    return response.text === ''
      ? []
      : [
          `${key}: ${response.status} is documented without a body, got ${response.text.slice(0, 80)}`,
        ];
  const mediaType = response.contentType.split(';')[0].trim();
  if (!content[mediaType])
    return [
      `${key}: answered ${mediaType || 'no content type'}, documented: ${Object.keys(content).join(', ')}`,
    ];
  if (mediaType !== 'application/json') {
    // Binary and text bodies: the schema is only `type: string`.
    return response.text.length > 0 ? [] : [`${key}: empty ${mediaType} body`];
  }
  const validate = validator(key, response.status, mediaType);
  if (validate(response.body)) return [];
  return (validate.errors ?? []).map(
    (error) =>
      `${key} ${response.status}: ${error.instancePath || '(body)'} ${error.message} ${JSON.stringify(error.params)}`,
  );
}
