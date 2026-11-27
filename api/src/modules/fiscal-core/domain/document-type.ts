import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

export type DocumentType = 'nfse' | 'nfe' | 'nfce';

export interface DocumentRef {
  type: DocumentType;
  id: string;
  tenantId: string;
  environment: ExecutionEnvironment;
}
