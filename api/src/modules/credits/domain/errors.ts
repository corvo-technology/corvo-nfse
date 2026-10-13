export class InsufficientCreditsError extends Error {
  constructor(tenantId: string) {
    super(`Insufficient credits for tenant ${tenantId}`);
    this.name = 'InsufficientCreditsError';
  }
}
