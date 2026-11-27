import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { MonetizzeConnector } from './monetizze.connector';

/** Loaded by both the API (inbound postbacks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    { provide: MonetizzeConnector, useFactory: () => new MonetizzeConnector() },
  ],
})
export class MonetizzeConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: MonetizzeConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
