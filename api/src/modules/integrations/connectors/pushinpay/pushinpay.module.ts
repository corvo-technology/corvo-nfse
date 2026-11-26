import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { PushinPayConnector } from './pushinpay.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [PushinPayConnector],
})
export class PushinPayConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: PushinPayConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
