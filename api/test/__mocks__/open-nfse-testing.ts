// Mock for open-nfse/testing — fake client for tests
import { NfseClient } from './open-nfse';

export class NfseClientFake extends NfseClient {
  emitir(_params: any) {
    return Promise.resolve({
      status: 'ok',
      nfse: { chaveAcesso: 'fake-key', numeroNfse: 1, xml: '<xml/>' },
    });
  }
}
