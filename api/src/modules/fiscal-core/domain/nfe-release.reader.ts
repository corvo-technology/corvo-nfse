/** When a goods document type was released for a tenant (null = not released). */
export interface NfeReleaseReader {
  releasedAt(tenantId: string, type?: 'nfe' | 'nfce'): Promise<Date | null>;
}

export const NFE_RELEASE_READER = Symbol('NFE_RELEASE_READER');
