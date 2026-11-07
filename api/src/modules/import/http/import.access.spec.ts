import 'reflect-metadata';
import { API_KEY_ENDPOINT } from '@/modules/auth/api-key-endpoint.decorator';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';
import { ImportController } from './import.controller';

/** Every import route is part of the public API-key surface; reads need view, actions need issue. */
describe('ImportController access', () => {
  const proto = ImportController.prototype as unknown as Record<string, object>;
  const routes: Array<[string, 'nfse.invoices.view' | 'nfse.invoices.issue']> =
    [
      ['start', 'nfse.invoices.issue'],
      ['list', 'nfse.invoices.view'],
      ['template', 'nfse.invoices.view'],
      ['get', 'nfse.invoices.view'],
      ['rows', 'nfse.invoices.view'],
      ['errors', 'nfse.invoices.view'],
      ['updateRow', 'nfse.invoices.issue'],
      ['emit', 'nfse.invoices.issue'],
      ['discard', 'nfse.invoices.issue'],
    ];

  it.each(routes)(
    '%s is open to API keys and needs %s',
    (handler, permission) => {
      const fn = proto[handler];
      expect(Reflect.getMetadata(API_KEY_ENDPOINT, fn)).toBe(true);
      expect(Reflect.getMetadata(REQUIRED_TENANT_PERMISSION, fn)).toBe(
        permission,
      );
    },
  );

  it('covers every handler of the controller', () => {
    const handlers = Object.getOwnPropertyNames(
      ImportController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(handlers.sort()).toEqual(routes.map(([name]) => name).sort());
  });
});
