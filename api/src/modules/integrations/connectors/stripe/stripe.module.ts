import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { StripeConnector } from './stripe.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    { provide: StripeConnector, useFactory: () => new StripeConnector() },
  ],
})
export class StripeConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: StripeConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
