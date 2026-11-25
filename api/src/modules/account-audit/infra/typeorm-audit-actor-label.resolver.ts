import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  AuthOAuthClientOrmEntity,
  AuthUserOrmEntity,
} from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { ApiKeyOrmEntity } from '@/modules/auth/infra/api-key.orm-entity';
import { McpConnectionOrmEntity } from '@/modules/mcp/infra/mcp-connection.orm-entity';
import type { AuditActorRef } from '../domain/account-audit';
import {
  AuditActorLabeler,
  type ResolvedActorLabel,
} from '../domain/account-audit.repository';

export const SYSTEM_LABEL = 'Sistema';
export const DEFAULT_AGENT_LABEL = 'Agente de IA';
const DEFAULT_KEY_LABEL = 'Chave de API';
const DEFAULT_USER_LABEL = 'Usuário';

/**
 * Names the actor at the moment of the action; the label is stored on the event
 * and does not change if the person, key or agent is renamed later.
 */
@Injectable()
export class TypeOrmAuditActorLabelResolver extends AuditActorLabeler {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async resolve(
    actor: AuditActorRef,
    tenantId: string,
  ): Promise<ResolvedActorLabel> {
    switch (actor.type) {
      case 'system':
        return { label: SYSTEM_LABEL, onBehalfOf: null };
      case 'user':
        return {
          label: (await this.userLabel(actor.id)) ?? DEFAULT_USER_LABEL,
          onBehalfOf: null,
        };
      case 'api_key':
        return {
          label: (await this.keyLabel(actor.id, tenantId)) ?? DEFAULT_KEY_LABEL,
          onBehalfOf: null,
        };
      case 'agent': {
        const [label, onBehalfOf] = await Promise.all([
          this.agentLabel(actor.id, tenantId),
          this.userLabel(actor.onBehalfOfUserId ?? null),
        ]);
        return { label: label ?? DEFAULT_AGENT_LABEL, onBehalfOf };
      }
    }
  }

  private async userLabel(id: string | null): Promise<string | null> {
    if (!id) return null;
    const user = await this.dataSource.manager
      .getRepository(AuthUserOrmEntity)
      .findOneBy({ id });
    return user ? user.name.trim() || user.email : null;
  }

  private keyLabel(id: string | null, tenantId: string) {
    if (!id) return Promise.resolve(null);
    return runWithTenant(tenantId, async () => {
      const key = await this.dataSource.manager
        .getRepository(ApiKeyOrmEntity)
        .findOneBy({ id, tenantId });
      return key?.name ?? null;
    });
  }

  private agentLabel(id: string | null, tenantId: string) {
    if (!id) return Promise.resolve(null);
    return runWithTenant(tenantId, async () => {
      const connection = await this.dataSource.manager
        .getRepository(McpConnectionOrmEntity)
        .findOneBy({ id, tenantId });
      if (!connection) return null;
      const client = await this.dataSource.manager
        .getRepository(AuthOAuthClientOrmEntity)
        .findOneBy({ id: connection.clientId });
      return client?.name ?? null;
    });
  }
}
