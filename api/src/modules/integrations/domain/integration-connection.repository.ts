import type { IntegrationConnection } from './integration-connection';

export abstract class IIntegrationConnectionRepository {
  abstract insert(
    connection: IntegrationConnection,
  ): Promise<IntegrationConnection>;
  abstract update(
    connection: IntegrationConnection,
  ): Promise<IntegrationConnection>;
  abstract findById(
    id: string,
    tenantId: string,
  ): Promise<IntegrationConnection | null>;
  abstract listByTenant(tenantId: string): Promise<IntegrationConnection[]>;
  /** Runs as the system: the inbound endpoint knows no tenant yet. */
  abstract findByPublicId(
    publicId: string,
  ): Promise<IntegrationConnection | null>;
}
