import { Inject, Injectable } from '@nestjs/common';
import type { FiscalProvider } from './nfse-fiscal-provider';
import { FAKE_NFSE_PROVIDER, OPEN_NFSE_PROVIDER } from './nfse.constants';

@Injectable()
export class NfseProviderFactory {
  constructor(
    @Inject(FAKE_NFSE_PROVIDER) private readonly fake: FiscalProvider,
    @Inject(OPEN_NFSE_PROVIDER) private readonly real: FiscalProvider,
  ) {}

  resolve(apiKeyEnvironment: 'live' | 'test' | undefined): FiscalProvider {
    return apiKeyEnvironment === 'live' ? this.real : this.fake;
  }
}
