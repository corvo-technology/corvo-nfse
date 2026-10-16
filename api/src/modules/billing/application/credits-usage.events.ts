export const CREDITS_USAGE_CHANGED = 'billing.credits.usage_changed';

/** Published after a live emission reserved one credit of the tenant's period. */
export type CreditsUsageChangedEvent = {
  name: typeof CREDITS_USAGE_CHANGED;
  tenantId: string;
  occurredAt: Date;
};

export function creditsUsageChanged(
  tenantId: string,
): CreditsUsageChangedEvent {
  return { name: CREDITS_USAGE_CHANGED, tenantId, occurredAt: new Date() };
}
