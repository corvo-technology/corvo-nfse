import {
  NfseClient,
  ReceitaRejectionError,
  ValidationError,
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
  const provider = new OpenNfseProvider(
    {} as never,
    { get: () => undefined } as never,
  );
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
        new (ReceitaRejectionError as unknown as new (
          message: string,
          code: string,
        ) => Error)('Prazo expirado', 'E0840'),
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

  describe('replay of a stored cancellation event', () => {
    const stored = [{ kind: 'cancelamento_simples' } as PendingEvent];

    it('maps a permanent replay failure to rejected with code and message', async () => {
      jest
        .spyOn(NfseClient.prototype as any, 'replayPendingEvents')
        .mockResolvedValue([
          {
            id: 'p1',
            status: 'failed_permanent',
            error: new (ReceitaRejectionError as unknown as new (
              message: string,
              code: string,
            ) => Error)('Prazo expirado', 'E0840'),
          },
        ]);
      const { provider } = providerWith(stored);
      await expect(provider.cancel(payload)).resolves.toEqual({
        status: 'rejected',
        errorCode: 'E0840',
        errorMessage: 'Prazo expirado',
      });
    });

    it('reports pending with the replay error when still pending', async () => {
      jest
        .spyOn(NfseClient.prototype as any, 'replayPendingEvents')
        .mockResolvedValue([
          { id: 'p1', status: 'still_pending', error: new Error('sefin 503') },
        ]);
      const { provider } = providerWith(stored);
      await expect(provider.cancel(payload)).resolves.toEqual({
        status: 'pending',
        errorMessage: 'sefin 503',
      });
    });

    it('reports pending when the retry window has not elapsed (empty replay)', async () => {
      jest
        .spyOn(NfseClient.prototype as any, 'replayPendingEvents')
        .mockResolvedValue([]);
      const { provider } = providerWith(stored);
      await expect(provider.cancel(payload)).resolves.toEqual({
        status: 'pending',
        errorMessage: 'Awaiting fiscal retry window',
      });
    });
  });

  it('maps a local validation error to INVALID_FISCAL_INPUT', async () => {
    jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockRejectedValue(
        new (ValidationError as unknown as new (message: string) => Error)(
          'xMotivo is required',
        ),
      );
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'rejected',
      errorCode: 'INVALID_FISCAL_INPUT',
      errorMessage: 'xMotivo is required',
    });
  });

  it('closes the client after a successful cancellation', async () => {
    jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockResolvedValue({ status: 'ok', evento: {} });
    const close = jest.spyOn(NfseClient.prototype, 'close');
    const { provider } = providerWith();
    await provider.cancel(payload);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the client even when cancelar throws', async () => {
    jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockRejectedValue(new Error('certificate unreadable'));
    const close = jest.spyOn(NfseClient.prototype, 'close');
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
