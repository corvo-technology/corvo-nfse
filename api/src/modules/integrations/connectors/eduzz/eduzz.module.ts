import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { EduzzConnector } from './eduzz.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    { provide: EduzzConnector, useFactory: () => new EduzzConnector() },
  ],
})
export class EduzzConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: EduzzConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
