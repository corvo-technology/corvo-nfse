export interface WebhookConfig {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  secret: string;
  /** Set when an API key created it: it then only gets events of that environment. NULL = both. */
  environment: 'test' | 'live' | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** An API key sees only the endpoints of its own environment; endpoints for both count as live. */
export function webhookVisibleTo(
  config: Pick<WebhookConfig, 'environment'>,
  keyEnvironment?: 'test' | 'live',
): boolean {
  if (!keyEnvironment) return true;
  return (config.environment ?? 'live') === keyEnvironment;
}
