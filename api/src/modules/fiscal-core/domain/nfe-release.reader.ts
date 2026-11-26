/** When NF-e was released for a tenant (null = not released). */
export interface NfeReleaseReader {
  releasedAt(tenantId: string): Promise<Date | null>;
}

export const NFE_RELEASE_READER = Symbol('NFE_RELEASE_READER');
