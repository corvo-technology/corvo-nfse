import { originOf } from './invoice-origin';

describe('originOf', () => {
  it.each([
    [
      { idempotencyKey: 'integ_ab12', externalId: 'charge:441d455e' },
      'integration',
    ],
    [
      { idempotencyKey: 'schedule:s1:2026-01-05', externalId: null },
      'schedule',
    ],
    [{ idempotencyKey: 'import:i1:3', externalId: 'x' }, 'import'],
    [{ idempotencyKey: 'k1', externalId: 'dashboard-9f2' }, 'dashboard'],
    [{ idempotencyKey: 'k1', externalId: 'pedido-12' }, 'api'],
    [{ idempotencyKey: null, externalId: null }, 'api'],
  ] as const)('%j -> %s', (invoice, origin) => {
    expect(originOf(invoice)).toBe(origin);
  });
});
