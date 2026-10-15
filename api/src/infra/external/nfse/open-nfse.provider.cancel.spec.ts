import {
  NfseClient,
  ReceitaRejectionError,
  type PendingEvent,
  type RetryStore,
} from 'open-nfse';
import { OpenNfseProvider } from './open-nfse.provider';
import type { ICancelPayload } from './nfse-fiscal-provider';

const payload: ICancelPayload = {
  invoiceId: 'inv-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  accessKey: '3'.repeat(50),
  environment: 'live',
  pfxBuffer: Buffer.from('pfx'),
  p12Password: 'secret',
  emitenteCnpj: '11222333000181',
  reason: 'service_not_provided',
  description: 'Serviço não foi prestado ao cliente',
};

function providerWith(pending: PendingEvent[] = []) {
  const store: RetryStore = {
    save: jest.fn(),
    list: jest.fn().mockResolvedValue(pending),
    delete: jest.fn(),
  };
  const provider = new OpenNfseProvider({} as never);
  jest.spyOn(provider as any, 'store').mockReturnValue(store);
  return { provider, store };
}

afterEach(() => jest.restoreAllMocks());

describe('OpenNfseProvider.cancel', () => {
  it('sends event 101101 with the mapped reason and the retry store', async () => {
    const cancelar = jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockResolvedValue({ status: 'ok', evento: {} });
    const { provider, store } = providerWith();
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(cancelar).toHaveBeenCalledWith({
      chaveAcesso: payload.accessKey,
      autor: { CNPJ: payload.emitenteCnpj },
      cMotivo: '2',
      xMotivo: payload.description,
      retryStore: store,
    });
  });

  it('reports pending when the Sefin call fails transiently', async () => {
    jest.spyOn(NfseClient.prototype as any, 'cancelar').mockResolvedValue({
      status: 'retry_pending',
      pending: {},
      error: new Error('timeout'),
    });
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'pending',
      errorMessage: 'timeout',
    });
  });

  it('replays the stored signed event instead of signing a new one', async () => {
    const cancelar = jest.spyOn(NfseClient.prototype as any, 'cancelar');
    const replay = jest
      .spyOn(NfseClient.prototype as any, 'replayPendingEvents')
      .mockResolvedValue([{ id: 'p1', status: 'success', evento: {} }]);
    const { provider, store } = providerWith([
      { kind: 'cancelamento_simples' } as PendingEvent,
    ]);
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(replay).toHaveBeenCalledWith(store);
    expect(cancelar).not.toHaveBeenCalled();
  });

  it('maps a permanent Sefin rejection to rejected', async () => {
    jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      // The jest mock of open-nfse takes (message, code); the real class takes options.
      .mockRejectedValue(
        new (ReceitaRejectionError as any)('Prazo expirado', 'E0840'),
      );
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'rejected',
      errorCode: 'E0840',
      errorMessage: 'Prazo expirado',
    });
  });

  it('rethrows unexpected errors so the job retries', async () => {
    jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockRejectedValue(new Error('certificate unreadable'));
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).rejects.toThrow(
      'certificate unreadable',
    );
  });
});
