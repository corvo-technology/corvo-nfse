import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

export interface NumberingScope {
  companyId: string;
  tenantId: string;
  environment: ExecutionEnvironment;
  model: 55 | 65;
  series: number;
}

export interface DocumentNumbering {
  /** Atomic reservation of the next number of (company, model, series). It never goes back. */
  reserveNext(
    scope: NumberingScope,
  ): Promise<{ series: number; number: number }>;
  raiseTo(scope: NumberingScope, lastUsed: number): Promise<void>;
}
