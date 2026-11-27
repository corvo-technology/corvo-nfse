import { Module, type OnModuleInit } from '@nestjs/common';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { MercadoPagoConnector } from './mercadopago.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    {
      provide: MercadoPagoConnector,
      useFactory: () => new MercadoPagoConnector(),
    },
  ],
})
export class MercadoPagoConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: MercadoPagoConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
