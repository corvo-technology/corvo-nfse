import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import { FiscalCoreModule } from '@/modules/fiscal-core/fiscal-core.module';
import { NfseGatewayAdapter } from './nfse-gateway.adapter';
import { OpenNfseProvider } from './open-nfse.provider';
import { FakeNfseProvider } from './fake-nfse.provider';
import { NfseProviderFactory } from './nfse-provider.factory';
import { FAKE_NFSE_PROVIDER, OPEN_NFSE_PROVIDER } from './nfse.constants';
import { FISCAL_PROVIDER, type FiscalProvider } from './nfse-fiscal-provider';

@Global()
@Module({
  imports: [FiscalCoreModule],
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
export class NfseExternalModule implements OnModuleInit {
  constructor(
    private readonly registry: FiscalDocumentRegistry,
    @Inject(OPEN_NFSE_PROVIDER) private readonly provider: FiscalProvider,
  ) {}

  /** Exposes the NFS-e provider through the shared fiscal ports; the NFS-e workflow is unchanged. */
  onModuleInit(): void {
    this.registry.register(new NfseGatewayAdapter(this.provider));
  }
}
