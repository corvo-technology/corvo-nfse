import { Injectable } from '@nestjs/common';
import { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';
import {
  ConnectorAuthError,
  ConnectorDataError,
  type NormalizedOperation,
} from '../domain/connector';
import { ConnectorRegistry } from '../domain/connector-registry';
import type { ClaimedEvent } from '../domain/integration-event.repository';
import { IIntegrationOperationRepository } from '../domain/integration-operation.repository';
import { ConnectionService } from './connection.service';
import { EventHandler, type EventOutcome } from './event-handler';
import { OperationEmitter } from './operation-emitter.service';

@Injectable()
export class EventHandlerService extends EventHandler {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connections: ConnectionService,
    private readonly operations: IIntegrationOperationRepository,
    private readonly emitter: OperationEmitter,
    private readonly cipher: SecretsCipherService,
  ) {
    super();
  }

  async handle(event: ClaimedEvent): Promise<EventOutcome> {
    const connection = await this.connections.get(
      event.tenantId,
      event.connectionId,
    );
    const connector = this.registry.get(event.provider);
    const rawBody = this.cipher.decrypt(event.payloadEnc);
    const delivery = connector.parse({
      rawBody: Buffer.from(rawBody, 'utf8'),
      headers: {},
      query: {},
    });
    if (delivery.kind !== 'operation') return { state: 'ignored' };

    let normalized: NormalizedOperation;
    try {
      normalized = await connector.normalize({
        connection: this.connections.toView(connection),
        payload: rawBody,
        delivery,
      });
    } catch (error) {
      if (error instanceof ConnectorAuthError) {
        await this.connections.requireReauth(connection);
        return { state: 'needs_attention', lastError: error.message };
      }
      if (error instanceof ConnectorDataError)
        return { state: 'needs_attention', lastError: error.message };
      throw error;
    }

    const operation = await this.operations.upsertFromNormalized({
      tenantId: event.tenantId,
      connectionId: event.connectionId,
      provider: event.provider,
      environment: connection.environment,
      externalAccountId: connection.externalAccountId ?? '',
      normalized,
    });
    return this.emitter.run(operation);
  }
}
