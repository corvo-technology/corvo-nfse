export const ICompanyCertificateReader = Symbol('ICompanyCertificateReader');

export interface ICompanyCertificateReader {
  /**
   * Returns true if the given company has at least one active, non-expired certificate.
   */
  hasActiveCertificate(
    companyId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
    tenantId: string,
  ): Promise<boolean>;

  /**
   * Returns active certificate status for a list of company IDs.
   * Used for batch loading (no N+1).
   */
  activeCertificateCounts(
    companyIds: string[],
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
    tenantId: string,
  ): Promise<Map<string, boolean>>;
}
