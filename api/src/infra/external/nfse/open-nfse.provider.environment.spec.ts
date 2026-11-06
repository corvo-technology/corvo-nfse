import { NfseClient } from 'open-nfse';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { OpenNfseProvider } from './open-nfse.provider';
import type { ICancelPayload } from './nfse-fiscal-provider';

const tenantId = '11111111-1111-4111-8111-111111111111';
const payload = (environment: 'live' | 'test'): ICancelPayload => ({
  invoiceId: 'inv-1',
  tenantId,
  accessKey: '3'.repeat(50),
  environment,
  pfxBuffer: Buffer.from('pfx'),
  p12Password: 'secret',
  emitenteCnpj: '11222333000181',
  reason: 'service_not_provided',
  description: 'Serviço não foi prestado ao cliente',
});

const provider = (
  config: Record<string, string> = {},
  database: unknown = {},
) =>
  new OpenNfseProvider(
    database as never,
    {
      get: (key: string) => config[key],
    } as never,
  );

afterEach(() => jest.restoreAllMocks());

describe('OpenNfseProvider: the Sefin follows the invoice environment', () => {
  const ambiente = (p: OpenNfseProvider, environment: 'live' | 'test') =>
    (
      p as unknown as {
        client: (x: ICancelPayload) => { options?: unknown };
      }
    ).client(payload(environment));

  it.each([
    ['test', {}, 'restricted'],
    ['test', { NFSE_SEFIN_ENVIRONMENT: 'production' }, 'restricted'],
    ['live', {}, 'production'],
    ['live', { NFSE_SEFIN_ENVIRONMENT: 'restricted' }, 'restricted'],
  ] as const)(
    'a %s invoice with %j goes to the Sefin %s',
    (environment, config, expected) => {
      const p = provider({ ...config });
      expect(
        (p as unknown as { sefinFor: (e: string) => string }).sefinFor(
          environment,
        ),
      ).toBe(expected);
    },
  );

  it('signs and sends a test invoice instead of refusing it', async () => {
    jest
      .spyOn(NfseClient.prototype as never, 'cancelar')
      .mockResolvedValue({ status: 'ok', evento: {} } as never);
    const p = provider();
    jest.spyOn(p as never, 'store').mockReturnValue({
      save: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    } as never);
    await expect(p.cancel(payload('test'))).resolves.toEqual({
      status: 'cancelled',
    });
    expect(ambiente(p, 'test')).toBeDefined();
  });

  it('keeps the pending-event slot of the invoice in ITS environment', async () => {
    const where = jest.fn().mockReturnThis();
    const builder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where,
      setParameter: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const p = provider(
      {},
      { getRepository: () => ({ createQueryBuilder: () => builder }) },
    );
    const store = (
      p as unknown as {
        store: (x: ICancelPayload) => {
          save: (e: unknown) => Promise<void>;
        };
      }
    ).store(payload('test'));
    await runWithTenant(tenantId, () =>
      store.save({ kind: 'cancelamento_simples' }),
    );
    expect(where).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'test' }),
    );
  });
});
