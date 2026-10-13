// Mock for open-nfse/testing — fake client for tests
import { NfseClient, ReceitaRejectionError } from './open-nfse';

export class NfseClientFake extends NfseClient {
  async emitir(_params: any) {
    return {
      status: 'ok',
      nfse: { chaveAcesso: 'fake-key', numeroNfse: 1, xml: '<xml/>' },
    };
  }
}
