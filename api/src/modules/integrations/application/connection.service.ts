import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import { ConnectorRegistry } from '../domain/connector-registry';
import type {
  ConnectionView,
  IntegrationEnvironment,
} from '../domain/connector';
import {
  InvalidConnectionTransitionError,
  transitionState,
  type ConnectionState,
  type IntegrationConnection,
} from '../domain/integration-connection';
import { IIntegrationConnectionRepository } from '../domain/integration-connection.repository';
import { IIntegrationRuleRepository } from '../domain/integration-rule.repository';
import { CredentialsService } from './credentials.service';

export interface CreateConnectionInput {
  provider: string;
  companyId: string;
  environment: IntegrationEnvironment;
  credentials: Record<string, string>;
  activeFrom?: Date;
}

@Injectable()
export class ConnectionService {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connections: IIntegrationConnectionRepository,
    private readonly rules: IIntegrationRuleRepository,
    private readonly credentials: CredentialsService,
    private readonly companies: CompanyService,
  ) {}

  async create(
    tenantId: string,
    input: CreateConnectionInput,
  ): Promise<IntegrationConnection> {
    if (!this.registry.has(input.provider))
      throw new BadRequestException(`Unknown provider: ${input.provider}`);
    const { manifest } = this.registry.get(input.provider);
    const known = new Set(manifest.credentialFields.map((f) => f.key));
    for (const key of Object.keys(input.credentials))
      if (!known.has(key))
        throw new BadRequestException(`Unexpected credential field: ${key}`);
    const credentials: Record<string, string> = {};
    for (const field of manifest.credentialFields) {
      const value = input.credentials[field.key];
      if (value) credentials[field.key] = value;
      else if (field.generate)
        credentials[field.key] = randomBytes(24).toString('base64url');
      else
        throw new BadRequestException(`Missing credential field: ${field.key}`);
    }
    await this.companies.findById(input.companyId, tenantId, input.environment);
    const now = new Date();
    return this.connections.insert({
      id: randomUUID(),
      tenantId,
      companyId: input.companyId,
      publicId: randomBytes(18).toString('base64url'),
      provider: input.provider,
      environment: input.environment,
      externalAccountId: null,
      state: 'draft',
      credentialsEnc: this.credentials.seal(credentials),
      activeFrom: input.activeFrom ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async get(tenantId: string, id: string): Promise<IntegrationConnection> {
    const connection = await this.connections.findById(id, tenantId);
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }

  list(tenantId: string): Promise<IntegrationConnection[]> {
    return this.connections.listByTenant(tenantId);
  }

  async validate(tenantId: string, id: string): Promise<IntegrationConnection> {
    const connection = await this.get(tenantId, id);
    const connector = this.registry.get(connection.provider);
    const { externalAccountId } = await connector.validateConnection(
      this.credentials.open(connection.credentialsEnc),
    );
    return this.connections.update({
      ...connection,
      externalAccountId,
      updatedAt: new Date(),
    });
  }

  async activate(tenantId: string, id: string): Promise<IntegrationConnection> {
    const connection = await this.get(tenantId, id);
    if (!connection.externalAccountId)
      throw new ConflictException(
        'Validate the connection before activating it',
      );
    if ((await this.rules.countByConnection(id, tenantId)) === 0)
      throw new ConflictException('Add at least one rule before activating');
    return this.moveTo(connection, 'active');
  }

  async pause(tenantId: string, id: string): Promise<IntegrationConnection> {
    return this.moveTo(await this.get(tenantId, id), 'paused');
  }

  async disconnect(
    tenantId: string,
    id: string,
  ): Promise<IntegrationConnection> {
    return this.moveTo(await this.get(tenantId, id), 'disconnected');
  }

  /** Used by the worker when the platform rejects the credentials. */
  async requireReauth(connection: IntegrationConnection): Promise<void> {
    if (connection.state === 'active' || connection.state === 'paused')
      await this.moveTo(connection, 'reauth_required');
  }

  findByPublicId(publicId: string): Promise<IntegrationConnection | null> {
    return this.connections.findByPublicId(publicId);
  }

  toView(connection: IntegrationConnection): ConnectionView {
    return {
      publicId: connection.publicId,
      environment: connection.environment,
      externalAccountId: connection.externalAccountId ?? '',
      credentials: this.credentials.open(connection.credentialsEnc),
    };
  }

  private async moveTo(
    connection: IntegrationConnection,
    to: ConnectionState,
  ): Promise<IntegrationConnection> {
    try {
      const state = transitionState(connection.state, to);
      return await this.connections.update({
        ...connection,
        state,
        updatedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof InvalidConnectionTransitionError)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}
