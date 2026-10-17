import { Inject, Injectable } from '@nestjs/common';
import type { FiscalCalculationResult } from '../../domain/fiscal/fiscal-calculation-result';
import type { StepTrace } from '../../domain/fiscal/fiscal-context';
import {
  FISCAL_SNAPSHOT_REPOSITORY,
  type FiscalSnapshot,
  type IFiscalSnapshotRepository,
  type NewFiscalSnapshot,
} from '../../domain/fiscal/fiscal-snapshot.repository';

export interface PersistFiscalSnapshotInput {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly result: FiscalCalculationResult;
  readonly specialTaxRegime: string | null;
  readonly attempt: number;
  readonly trace: readonly StepTrace[];
  readonly calculatedAt?: Date;
}

/**
 * Builds and persists the immutable fiscal snapshot for an invoice. All money
 * values come from the calculation result as DecimalString and are handed to
 * the repository unchanged — the numeric(15,2) conversion happens only at the
 * persistence edge, so no value ever passes through a float.
 */
@Injectable()
export class FiscalSnapshotService {
  constructor(
    @Inject(FISCAL_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IFiscalSnapshotRepository,
  ) {}

  async persist(input: PersistFiscalSnapshotInput): Promise<string> {
    const { result } = input;
    const snapshot: NewFiscalSnapshot = {
      invoiceId: input.invoiceId,
      tenantId: input.tenantId,
      companyId: result.companyId,
      taxRegime: result.taxRegime,
      profileId: result.profileId,
      serviceProfileId: result.classification.serviceProfileId,
      specialTaxRegime: input.specialTaxRegime,
      attempt: input.attempt,
      calculationVersion: result.rulesVersion,
      grossAmount: result.taxableAmounts.gross,
      discountAmount: result.taxableAmounts.discount,
      issAmount: result.taxes.iss?.amount ?? null,
      cbsAmount: result.taxes.cbs?.amount ?? null,
      ibsTotalAmount: result.taxes.ibsTotal?.amount ?? null,
      netReceivableAmount: result.netReceivableAmount,
      result: { ...result, trace: input.trace },
      calculatedAt: input.calculatedAt ?? new Date(),
    };
    return this.snapshots.insert(snapshot);
  }

  findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<FiscalSnapshot | null> {
    return this.snapshots.findByInvoiceId(invoiceId, tenantId);
  }
}
