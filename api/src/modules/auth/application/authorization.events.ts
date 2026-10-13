export const AUTHORIZATION_CONTEXT_CHANGED = 'authorization.context.changed';
export const AUTHORIZATION_TENANT_METADATA_CHANGED =
  'authorization.tenant_metadata.changed';

export type AuthorizationContextChangedEvent = {
  name: typeof AUTHORIZATION_CONTEXT_CHANGED;
  authUserId: string;
  occurredAt: Date;
};

export type AuthorizationTenantMetadataChangedEvent = {
  name: typeof AUTHORIZATION_TENANT_METADATA_CHANGED;
  tenantId: string;
  occurredAt: Date;
};

export function authorizationContextChanged(
  authUserId: string,
): AuthorizationContextChangedEvent {
  return {
    name: AUTHORIZATION_CONTEXT_CHANGED,
    authUserId,
    occurredAt: new Date(),
  };
}

export function authorizationTenantMetadataChanged(
  tenantId: string,
): AuthorizationTenantMetadataChangedEvent {
  return {
    name: AUTHORIZATION_TENANT_METADATA_CHANGED,
    tenantId,
    occurredAt: new Date(),
  };
}
