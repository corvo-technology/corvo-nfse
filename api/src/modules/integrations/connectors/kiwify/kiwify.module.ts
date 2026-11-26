import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { KiwifyConnector } from './kiwify.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    { provide: KiwifyConnector, useFactory: () => new KiwifyConnector() },
  ],
})
export class KiwifyConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: KiwifyConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
