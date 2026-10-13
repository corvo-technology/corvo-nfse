import { Global, Module } from '@nestjs/common';
import { OpenNfseProvider } from './open-nfse.provider';
import { FakeNfseProvider } from './fake-nfse.provider';
import { NfseProviderFactory } from './nfse-provider.factory';
import { FAKE_NFSE_PROVIDER, OPEN_NFSE_PROVIDER } from './nfse.constants';
import { FISCAL_PROVIDER } from './nfse-fiscal-provider';

@Global()
@Module({
  providers: [
    OpenNfseProvider,
    FakeNfseProvider,
    NfseProviderFactory,
    { provide: FAKE_NFSE_PROVIDER, useClass: FakeNfseProvider },
    { provide: OPEN_NFSE_PROVIDER, useExisting: OpenNfseProvider },
    // Kept for Phase 3 compatibility — processors still inject FISCAL_PROVIDER directly
    { provide: FISCAL_PROVIDER, useExisting: OpenNfseProvider },
  ],
  exports: [NfseProviderFactory, FakeNfseProvider, OpenNfseProvider],
})
export class NfseExternalModule {}
