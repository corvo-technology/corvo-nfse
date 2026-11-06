import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FiscalProvider } from './nfse-fiscal-provider';
import { FAKE_NFSE_PROVIDER, OPEN_NFSE_PROVIDER } from './nfse.constants';

/**
 * Live goes to the real Sefin provider. Test goes to the real provider as well (the Sefin Produção
 * Restrita, no legal validity), unless `NFSE_TEST_PROVIDER=fake` keeps the in-process simulator
 * (automated tests only).
 */
@Injectable()
export class NfseProviderFactory {
  constructor(
    @Inject(FAKE_NFSE_PROVIDER) private readonly fake: FiscalProvider,
    @Inject(OPEN_NFSE_PROVIDER) private readonly real: FiscalProvider,
    private readonly config: ConfigService,
  ) {}

  /** True when this environment's invoices never reach the Sefin (no certificate is needed). */
  isSimulated(apiKeyEnvironment: 'live' | 'test' | undefined): boolean {
    return (
      apiKeyEnvironment !== 'live' &&
      this.config.get<string>('NFSE_TEST_PROVIDER') === 'fake'
    );
  }

  resolve(apiKeyEnvironment: 'live' | 'test' | undefined): FiscalProvider {
    return this.isSimulated(apiKeyEnvironment) ? this.fake : this.real;
  }
}
