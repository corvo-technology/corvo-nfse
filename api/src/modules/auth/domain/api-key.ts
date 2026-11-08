export type ApiKeyEnvironment = 'live' | 'test';

export type ApiKeyScope =
  'full_access' | 'invoices_issue' | 'invoices_view' | 'invoices_read_write';

export type ApiKey = {
  id: string;
  tenantId: string;
  name: string;
  environment: ApiKeyEnvironment;
  keyPrefix: string;
  keyHash: string;
  scope: ApiKeyScope;
  /** Member who created the key; null for keys made before this was recorded. */
  createdByUserId?: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
};

export function isTestKey(key: ApiKey): boolean {
  return key.environment === 'test';
}

export function isLiveKey(key: ApiKey): boolean {
  return key.environment === 'live';
}
