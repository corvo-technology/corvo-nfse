import { PUBLIC_OPERATION_EXTENSION } from '@/modules/auth/api-key-endpoint.decorator';
import { PUBLIC_OPERATIONS } from './public-operations';
import { toPublicDocument, type OpenApiDocument } from './public-document';

function documentWith(paths: Record<string, unknown>): OpenApiDocument {
  return {
    openapi: '3.0.0',
    info: { title: 'x', version: '1' },
    paths,
    components: { schemas: {} },
  } as unknown as OpenApiDocument;
}

/** A document with one operation per entry of the contract, all marked public. */
function everyContractOperation() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(PUBLIC_OPERATIONS)) {
    const [method, path] = key.split(' ');
    paths[`/v1${path}`] = {
      ...paths[`/v1${path}`],
      [method.toLowerCase()]: {
        summary: 'x',
        responses: { '200': { description: 'ok' } },
        [PUBLIC_OPERATION_EXTENSION]: true,
      },
    };
  }
  return paths;
}

describe('toPublicDocument', () => {
  it('drops operations that are not marked public and strips the version prefix', () => {
    const paths = everyContractOperation();
    paths['/v1/auth/session'] = {
      get: { summary: 'session only', responses: { '200': {} } },
    };
    const result = toPublicDocument(documentWith(paths), 'v1');
    expect(Object.keys(result.paths)).not.toContain('/auth/session');
    expect(result.paths['/invoices']?.post?.operationId).toBe(
      'invoices_create',
    );
    expect(result.paths['/invoices']?.post?.security).toEqual([
      { ApiKeyAuth: [] },
    ]);
    expect(result.paths['/health/live']?.get?.security).toEqual([
      { ApiKeyAuth: [] },
    ]);
  });

  it('refuses a public route that has no entry in the contract', () => {
    const paths = everyContractOperation();
    paths['/v1/brand-new'] = {
      get: {
        summary: 'new',
        responses: { '200': {} },
        [PUBLIC_OPERATION_EXTENSION]: true,
      },
    };
    expect(() => toPublicDocument(documentWith(paths), 'v1')).toThrow(
      /GET \/brand-new has no entry in public-operations/,
    );
  });

  it('refuses a contract entry that no route matches', () => {
    const paths = everyContractOperation();
    delete paths['/v1/credits'];
    expect(() => toPublicDocument(documentWith(paths), 'v1')).toThrow(
      /GET \/credits, but no public route/,
    );
  });

  it('gives every contract entry a unique operationId', () => {
    const ids = Object.values(PUBLIC_OPERATIONS).map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
