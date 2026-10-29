import type { IntegrationRule } from './integration-rule';

export abstract class IIntegrationRuleRepository {
  abstract countByConnection(
    connectionId: string,
    tenantId: string,
  ): Promise<number>;
  abstract listByConnection(
    connectionId: string,
    tenantId: string,
  ): Promise<IntegrationRule[]>;
  abstract replaceForConnection(
    connectionId: string,
    tenantId: string,
    rules: Array<Omit<IntegrationRule, 'id' | 'tenantId' | 'connectionId'>>,
  ): Promise<IntegrationRule[]>;
}
