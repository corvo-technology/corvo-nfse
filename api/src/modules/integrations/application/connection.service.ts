import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import { ConnectorRegistry } from '../domain/connector-registry';
import {
  ConnectorAuthError,
  type ConnectionView,
  type IntegrationEnvironment,
} from '../domain/connector';
import {
  InvalidConnectionTransitionError,
  transitionState,
  type ConnectionState,
  type IntegrationConnection,
} from '../domain/integration-connection';
import { IIntegrationConnectionRepository } from '../domain/integration-connection.repository';
import type { IntegrationRule } from '../domain/integration-rule';
import { IIntegrationRuleRepository } from '../domain/integration-rule.repository';
import { CredentialsService } from './credentials.service';

export interface CreateConnectionInput {
  provider: string;
  companyId: string;
  environment: IntegrationEnvironment;
  credentials: Record<string, string>;
  activeFrom?: Date;
}

/** The platform refused the credential: a 422 the dashboard can translate, not a 500. */
async function refusal<T>(check: () => Promise<T>): Promise<T> {
  try {
    return await check();
  } catch (error) {
    if (error instanceof ConnectorAuthError)
      throw new UnprocessableEntityException({
        code: 'INTEGRATION_CREDENTIAL_REFUSED',
        message: error.message,
      });
    throw error;
  }
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
      throw new BadRequestException({
        code: 'INTEGRATION_PROVIDER_UNKNOWN',
        message: `Unknown provider: ${input.provider}`,
      });
    const { manifest } = this.registry.get(input.provider);
    const known = new Set(manifest.credentialFields.map((f) => f.key));
    for (const key of Object.keys(input.credentials))
      if (!known.has(key))
        throw new BadRequestException({
          code: 'INTEGRATION_CREDENTIAL_INVALID',
          message: `Unexpected credential field: ${key}`,
        });
    const credentials: Record<string, string> = {};
    for (const field of manifest.credentialFields) {
      const value = input.credentials[field.key];
      if (
        field.choices &&
        value &&
        !field.choices.some((choice) => choice.value === value)
      )
        throw new BadRequestException({
          code: 'INTEGRATION_CREDENTIAL_INVALID',
          message: `Invalid value for credential field: ${field.key}`,
        });
      if (value) credentials[field.key] = value;
      else if (field.choices?.length)
        credentials[field.key] = field.choices[0].value;
      else if (field.generate)
        credentials[field.key] = randomBytes(24).toString('base64url');
      else
        throw new BadRequestException({
          code: 'INTEGRATION_CREDENTIAL_INVALID',
          message: `Missing credential field: ${field.key}`,
        });
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
    if (!connection)
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Connection not found',
      });
    return connection;
  }

  list(tenantId: string): Promise<IntegrationConnection[]> {
    return this.connections.listByTenant(tenantId);
  }

  async validate(tenantId: string, id: string): Promise<IntegrationConnection> {
    const connection = await this.get(tenantId, id);
    const connector = this.registry.get(connection.provider);
    const { externalAccountId } = await refusal(() =>
      connector.validateConnection(
        this.credentials.open(connection.credentialsEnc),
        connection.environment,
        { publicId: connection.publicId },
      ),
    );
    return this.connections.update({
      ...connection,
      externalAccountId,
      updatedAt: new Date(),
    });
  }

  /**
   * Swaps the credentials the client typed (a rotated key, say). The new ones are checked
   * with the platform first, and a connection that was waiting for them starts working again.
   */
  async updateCredentials(
    tenantId: string,
    id: string,
    changes: Record<string, string>,
  ): Promise<IntegrationConnection> {
    const connection = await this.get(tenantId, id);
    if (connection.state === 'disconnected')
      throw new ConflictException({
        code: 'CONNECTION_DISCONNECTED',
        message: 'A disconnected connection cannot be edited',
      });
    const connector = this.registry.get(connection.provider);
    const editable = new Set(
      connector.manifest.credentialFields
        .filter((field) => !field.generate)
        .map((field) => field.key),
    );
    const keys = Object.keys(changes);
    if (keys.length === 0)
      throw new BadRequestException({
        code: 'INTEGRATION_CREDENTIAL_REQUIRED',
        message: 'Send at least one credential to change',
      });
    for (const key of keys) {
      if (!editable.has(key))
        throw new BadRequestException({
          code: 'INTEGRATION_CREDENTIAL_INVALID',
          message: `Cannot change credential field: ${key}`,
        });
      if (!changes[key]?.trim())
        throw new BadRequestException({
          code: 'INTEGRATION_CREDENTIAL_INVALID',
          message: `Empty credential field: ${key}`,
        });
    }
    for (const field of connector.manifest.credentialFields)
      if (
        field.choices &&
        keys.includes(field.key) &&
        !field.choices.some(
          (choice) => choice.value === changes[field.key].trim(),
        )
      )
        throw new BadRequestException({
          code: 'INTEGRATION_CREDENTIAL_INVALID',
          message: `Invalid value for credential field: ${field.key}`,
        });
    const merged = {
      ...this.credentials.open(connection.credentialsEnc),
      ...Object.fromEntries(keys.map((key) => [key, changes[key].trim()])),
    };
    const { externalAccountId } = await refusal(() =>
      connector.validateConnection(merged, connection.environment, {
        publicId: connection.publicId,
      }),
    );
    return this.connections.update({
      ...connection,
      credentialsEnc: this.credentials.seal(merged),
      externalAccountId,
      state:
        connection.state === 'reauth_required' ? 'active' : connection.state,
      updatedAt: new Date(),
    });
  }

  async activate(tenantId: string, id: string): Promise<IntegrationConnection> {
    const connection = await this.get(tenantId, id);
    if (!connection.externalAccountId)
      throw new ConflictException({
        code: 'CONNECTION_NOT_VALIDATED',
        message: 'Validate the connection before activating it',
      });
    if ((await this.rules.countByConnection(id, tenantId)) === 0)
      throw new ConflictException({
        code: 'CONNECTION_NEEDS_RULE',
        message: 'Add at least one rule before activating',
      });
    // Like emission, only production needs a ready company and a certificate.
    if (connection.environment === 'live')
      await this.companies.ensureReady(
        connection.companyId,
        tenantId,
        connection.environment,
      );
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

  async listRules(tenantId: string, id: string): Promise<IntegrationRule[]> {
    await this.get(tenantId, id);
    return this.rules.listByConnection(id, tenantId);
  }

  async replaceRules(
    tenantId: string,
    id: string,
    rules: Array<Omit<IntegrationRule, 'id' | 'tenantId' | 'connectionId'>>,
  ): Promise<IntegrationRule[]> {
    await this.get(tenantId, id);
    return this.rules.replaceForConnection(id, tenantId, rules);
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
        throw new ConflictException({
          code: 'CONNECTION_STATE_INVALID',
          message: error.message,
        });
      throw error;
    }
  }
}
