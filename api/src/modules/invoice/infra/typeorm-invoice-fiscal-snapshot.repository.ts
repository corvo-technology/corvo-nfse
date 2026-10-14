import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { FiscalCalculationResult } from '../domain/fiscal/fiscal-calculation-result';
import type {
  FiscalSnapshot,
  IFiscalSnapshotRepository,
  NewFiscalSnapshot,
} from '../domain/fiscal/fiscal-snapshot.repository';
import { InvoiceFiscalSnapshotOrmEntity } from './invoice-fiscal-snapshot.orm-entity';

interface InvoiceFiscalSnapshotRow {
  id: string;
  invoice_id: string;
  tenant_id: string;
  company_id: string;
  tax_regime: string;
  profile_id: string;
  service_profile_id: string | null;
  special_tax_regime: string | null;
  attempt: number;
  calculation_version: string;
  gross_amount: string;
  discount_amount: string;
  iss_amount: string | null;
  cbs_amount: string | null;
  ibs_total_amount: string | null;
  net_receivable_amount: string;
  result: FiscalCalculationResult;
  calculated_at: Date;
}

@Injectable()
export class TypeOrmInvoiceFiscalSnapshotRepository
  implements IFiscalSnapshotRepository
{
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  private table(): string {
    const metadata = this.dataSource.getMetadata(
      InvoiceFiscalSnapshotOrmEntity,
    );
    const escape = (identifier: string) =>
      this.dataSource.driver.escape(identifier);
    return metadata.schema
      ? `${escape(metadata.schema)}.${escape(metadata.tableName)}`
      : escape(metadata.tableName);
  }

  private rowsOf(raw: unknown): InvoiceFiscalSnapshotRow[] {
    const list = raw as unknown[];
    return (Array.isArray(list[0]) ? list[0] : list) as InvoiceFiscalSnapshotRow[];
  }

  async insert(snapshot: NewFiscalSnapshot): Promise<string> {
    const raw: unknown = await this.manager().query(
      `INSERT INTO ${this.table()} (invoice_id, tenant_id, company_id, tax_regime, profile_id, service_profile_id, special_tax_regime, attempt, calculation_version, gross_amount, discount_amount, iss_amount, cbs_amount, ibs_total_amount, net_receivable_amount, result, calculated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)
       ON CONFLICT (invoice_id, attempt) DO NOTHING
       RETURNING id`,
      [
        snapshot.invoiceId,
        snapshot.tenantId,
        snapshot.companyId,
        snapshot.taxRegime,
        snapshot.profileId,
        snapshot.serviceProfileId,
        snapshot.specialTaxRegime,
        snapshot.attempt,
        snapshot.calculationVersion,
        snapshot.grossAmount,
        snapshot.discountAmount,
        snapshot.issAmount,
        snapshot.cbsAmount,
        snapshot.ibsTotalAmount,
        snapshot.netReceivableAmount,
        JSON.stringify(snapshot.result),
        snapshot.calculatedAt,
      ],
    );
    const inserted = this.rowsOf(raw)[0];
    if (inserted) return inserted.id;
    // Re-delivery: the conflicting row is visible through the same tenant scope.
    const existing = await this.manager().query<InvoiceFiscalSnapshotRow[]>(
      `SELECT id FROM ${this.table()} WHERE invoice_id = $1 AND attempt = $2`,
      [snapshot.invoiceId, snapshot.attempt],
    );
    const row = existing[0];
    if (!row)
      throw new Error(
        'Fiscal snapshot insert conflicted outside the tenant scope',
      );
    return row.id;
  }

  async findByInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<FiscalSnapshot | null> {
    const rows = await this.manager().query<InvoiceFiscalSnapshotRow[]>(
      `SELECT * FROM ${this.table()} WHERE invoice_id = $1 AND tenant_id = $2 ORDER BY attempt DESC LIMIT 1`,
      [invoiceId, tenantId],
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  private toDomain(row: InvoiceFiscalSnapshotRow): FiscalSnapshot {
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      tenantId: row.tenant_id,
      companyId: row.company_id,
      taxRegime: row.tax_regime as FiscalSnapshot['taxRegime'],
      profileId: row.profile_id,
      serviceProfileId: row.service_profile_id,
      specialTaxRegime: row.special_tax_regime,
      attempt: row.attempt,
      calculationVersion: row.calculation_version,
      grossAmount: row.gross_amount,
      discountAmount: row.discount_amount,
      issAmount: row.iss_amount,
      cbsAmount: row.cbs_amount,
      ibsTotalAmount: row.ibs_total_amount,
      netReceivableAmount: row.net_receivable_amount,
      result: row.result,
      calculatedAt: row.calculated_at,
    };
  }
}
