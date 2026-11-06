import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';
import type {
  InboundRequest,
  OperationDelivery,
  ParsedDelivery,
} from '../domain/connector';
import type { IntegrationConnection } from '../domain/integration-connection';
import { ConnectorRegistry } from '../domain/connector-registry';
import { IIntegrationEventRepository } from '../domain/integration-event.repository';
import { ConnectionService } from './connection.service';

export type ReceiveStatus = 'accepted' | 'duplicate' | 'ignored' | 'test';

@Injectable()
export class InboundReceiverService {
  private readonly logger = new Logger(InboundReceiverService.name);

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connections: ConnectionService,
    private readonly events: IIntegrationEventRepository,
    private readonly cipher: SecretsCipherService,
  ) {}

  async receive(
    publicId: string,
    req: InboundRequest,
  ): Promise<{ status: ReceiveStatus }> {
    const connection = await this.connections.findByPublicId(publicId);
    if (
      !connection ||
      connection.state === 'draft' ||
      connection.state === 'disconnected'
    )
      throw new NotFoundException({
        code: 'INBOUND_INVALID',
        message: 'Not found',
      });

    const connector = this.registry.get(connection.provider);
    const auth = await connector.authenticate(
      req,
      this.connections.toView(connection),
    );
    if (!auth.ok) {
      this.logger.warn(
        `Rejected ${connection.provider} delivery: ${auth.reason}`,
      );
      throw new UnauthorizedException({
        code: 'INBOUND_INVALID',
        message: 'Invalid webhook authentication',
      });
    }

    const base = {
      tenantId: connection.tenantId,
      connectionId: connection.id,
      provider: connection.provider,
      environment: connection.environment,
      externalAccountId: connection.externalAccountId ?? '',
      payloadEnc: this.cipher.encrypt(req.rawBody.toString('utf8')),
    };

    let parsed: ParsedDelivery;
    try {
      parsed = connector.parse(req);
    } catch (error) {
      // Authenticated but unreadable: keep it for diagnosis and stop the platform from retrying forever.
      const result = await this.events.insertReceived({
        ...base,
        deliveryId: createHash('sha256').update(req.rawBody).digest('hex'),
        externalType: 'unparseable',
        state: 'needs_attention',
        lastError:
          error instanceof Error ? error.message.slice(0, 500) : 'parse failed',
      });
      return { status: result.created ? 'accepted' : 'duplicate' };
    }

    if (parsed.kind === 'test') return { status: 'test' };
    if (parsed.kind === 'ignored') return { status: 'ignored' };

    if (!this.belongsTo(connection, parsed)) {
      this.logger.warn(
        `Dropped ${connection.provider} delivery from another environment or account`,
      );
      return { status: 'ignored' };
    }

    const result = await this.events.insertReceived({
      ...base,
      deliveryId: parsed.deliveryId,
      externalType: parsed.externalType,
      state: 'received',
    });
    return { status: result.created ? 'accepted' : 'duplicate' };
  }

  /** A platform that reports its environment or account must match the connection. */
  private belongsTo(
    connection: IntegrationConnection,
    delivery: OperationDelivery,
  ): boolean {
    if (delivery.environment && delivery.environment !== connection.environment)
      return false;
    return (
      !delivery.externalAccountId ||
      !connection.externalAccountId ||
      delivery.externalAccountId === connection.externalAccountId
    );
  }
}
