export interface ICertificateDecryptor {
  decrypt(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<Buffer>;
}
