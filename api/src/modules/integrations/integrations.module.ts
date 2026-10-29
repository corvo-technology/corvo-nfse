import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';
import { CompanyModule } from '@/modules/company/company.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';
import { ConnectionService } from './application/connection.service';
import { CredentialsService } from './application/credentials.service';
import { EventHandler } from './application/event-handler';
import { EventHandlerService } from './application/event-handler.service';
import { EventProcessorService } from './application/event-processor.service';
import { InboundReceiverService } from './application/inbound-receiver.service';
import { OperationEmitter } from './application/operation-emitter.service';
import { OperationService } from './application/operation.service';
import { ConnectorRegistry } from './domain/connector-registry';
import { IIntegrationConnectionRepository } from './domain/integration-connection.repository';
import { IIntegrationEventRepository } from './domain/integration-event.repository';
import { IIntegrationOperationRepository } from './domain/integration-operation.repository';
import { IIntegrationRuleRepository } from './domain/integration-rule.repository';
import { InboundController } from './http/inbound.controller';
import { InboundRateLimitGuard } from './http/inbound-rate-limit.guard';
import { IntegrationsController } from './http/integrations.controller';
import { IntegrationConnectionOrmEntity } from './infra/integration-connection.orm-entity';
import { IntegrationEventOrmEntity } from './infra/integration-event.orm-entity';
import { IntegrationOperationOrmEntity } from './infra/integration-operation.orm-entity';
import { IntegrationRuleOrmEntity } from './infra/integration-rule.orm-entity';
import { TypeOrmIntegrationConnectionRepository } from './infra/typeorm-integration-connection.repository';
import { TypeOrmIntegrationEventRepository } from './infra/typeorm-integration-event.repository';
import { TypeOrmIntegrationOperationRepository } from './infra/typeorm-integration-operation.repository';
import { TypeOrmIntegrationRuleRepository } from './infra/typeorm-integration-rule.repository';

/**
 * Platform connectors are separate modules that register themselves on the
 * shared `ConnectorRegistry` when they initialize.
 */
@Module({
  imports: [
    CompanyModule,
    InvoiceModule,
    TypeOrmModule.forFeature([
      IntegrationConnectionOrmEntity,
      IntegrationEventOrmEntity,
      IntegrationOperationOrmEntity,
      IntegrationRuleOrmEntity,
    ]),
  ],
  controllers: [InboundController, IntegrationsController],
  providers: [
    ConnectorRegistry,
    SecretsCipherService,
    RedisRateLimiter,
    InboundRateLimitGuard,
    CredentialsService,
    ConnectionService,
    InboundReceiverService,
    OperationEmitter,
    OperationService,
    EventProcessorService,
    { provide: EventHandler, useClass: EventHandlerService },
    {
      provide: IIntegrationConnectionRepository,
      useClass: TypeOrmIntegrationConnectionRepository,
    },
    {
      provide: IIntegrationEventRepository,
      useClass: TypeOrmIntegrationEventRepository,
    },
    {
      provide: IIntegrationOperationRepository,
      useClass: TypeOrmIntegrationOperationRepository,
    },
    {
      provide: IIntegrationRuleRepository,
      useClass: TypeOrmIntegrationRuleRepository,
    },
  ],
  exports: [ConnectorRegistry, EventProcessorService, ConnectionService],
})
export class IntegrationsModule implements OnModuleInit {
  onModuleInit(): void {
    // Real connectors register in their own modules; nothing is registered here.
  }
}
