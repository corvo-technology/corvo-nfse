import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { PagarmeConnector } from './pagarme.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [PagarmeConnector],
})
export class PagarmeConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: PagarmeConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
