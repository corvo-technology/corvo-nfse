import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { HotmartConnector } from './hotmart.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    { provide: HotmartConnector, useFactory: () => new HotmartConnector() },
  ],
})
export class HotmartConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: HotmartConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
