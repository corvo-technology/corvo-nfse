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

  /** The series and the last DPS number used (0 when none yet). */
  current(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<{ series: string; lastNumber: number }>;

  /**
   * Makes the next DPS number follow `lastNumber`. It only moves forward: a lower value is
   * ignored, because going back would reuse numbers the Receita already has.
   */
  raiseTo(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
    lastNumber: number,
  ): Promise<{ series: string; lastNumber: number }>;
}

export const DPS_SEQUENCE_REPOSITORY = 'DPS_SEQUENCE_REPOSITORY';
