import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { AsaasConnector } from './asaas.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    { provide: AsaasConnector, useFactory: () => new AsaasConnector() },
  ],
})
export class AsaasConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: AsaasConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
