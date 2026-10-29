import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { WooviConnector } from './woovi.connector';
import { WooviPublicKeyProvider } from './woovi-public-key.provider';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    // Built by hand: their constructors take optional test seams, not injectable services.
    {
      provide: WooviPublicKeyProvider,
      useFactory: () => new WooviPublicKeyProvider(),
    },
    WooviConnector,
  ],
})
export class WooviConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: WooviConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
