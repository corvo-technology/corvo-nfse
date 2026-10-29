import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '../../domain/connector-registry';
import { IntegrationsModule } from '../../integrations.module';
import { AbacatePayConnector } from './abacatepay.connector';

/** Loaded by both the API (inbound webhooks) and the worker (normalizing events). */
@Module({
  imports: [IntegrationsModule],
  providers: [
    {
      provide: AbacatePayConnector,
      useFactory: (config: ConfigService) =>
        new AbacatePayConnector(
          config.get<string>('ABACATEPAY_WEBHOOK_PUBLIC_KEY') || undefined,
        ),
      inject: [ConfigService],
    },
  ],
})
export class AbacatePayConnectorModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connector: AbacatePayConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.connector);
  }
}
