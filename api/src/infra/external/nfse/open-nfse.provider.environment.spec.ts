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

describe('OpenNfseProvider.queryByDps: asks the portal of the invoice environment', () => {
  const idDps = 'DPS353470826146948700014000001000000000000002';
  const note = (tipoAmbiente: 'PRODUCAO' | 'HOMOLOGACAO') => ({
    chaveAcesso: '3'.repeat(50),
    xmlNfse: '<NFSe/>',
    nfse: { infNFSe: { nNFSe: '1' } },
    tipoAmbiente,
  });
  const query = async (
    environment: 'live' | 'test',
    answer: 'PRODUCAO' | 'HOMOLOGACAO',
  ) => {
    const p = provider();
    const built: unknown[] = [];
    jest.spyOn(p as never, 'client').mockImplementation(((
      x: ICancelPayload,
    ) => {
      built.push(x.environment);
      return {
        fetchDpsStatus: jest.fn().mockResolvedValue({
          chaveAcesso: '3'.repeat(50),
          tipoAmbiente: answer,
        }),
        fetchByChave: jest.fn().mockResolvedValue(note(answer)),
        close: jest.fn(),
      };
    }) as never);
    const warn = jest
      .spyOn((p as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation();
    await p.queryByDps(idDps, payload(environment) as never);
    return { built, warn, p };
  };

  it('a live lookup goes to production and stays quiet when the portal agrees', async () => {
    const { built, warn, p } = await query('live', 'PRODUCAO');
    expect(built).toEqual(['live']);
    expect(
      (p as unknown as { sefinFor: (e: string) => string }).sefinFor('live'),
    ).toBe('production');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs both sides when a live lookup comes back as a homologation note', async () => {
    const { warn } = await query('live', 'HOMOLOGACAO');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        idDps,
        invoiceEnvironment: 'live',
        askedAmbiente: 'PRODUCAO',
        noteTipoAmbiente: 'HOMOLOGACAO',
      }),
      expect.stringContaining('another environment'),
    );
  });
});
