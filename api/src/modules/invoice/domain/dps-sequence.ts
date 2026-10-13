export interface DpsSequenceProps {
  companyId: string;
  series: string;
  currentNumber: number;
  updatedAt: Date;
}

export interface IDpsSequenceRepository {
  reserveNext(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<{ series: string; number: number }>;
}

export const DPS_SEQUENCE_REPOSITORY = 'DPS_SEQUENCE_REPOSITORY';
