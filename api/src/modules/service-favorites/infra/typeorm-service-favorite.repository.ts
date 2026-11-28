import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { IServiceFavoriteRepository } from '../domain/service-favorite';
import type {
  FavoriteKind,
  NewServiceFavorite,
  ServiceFavorite,
} from '../domain/service-favorite';
import { ServiceFavoriteOrmEntity } from './service-favorite.orm-entity';

interface Row {
  id: string;
  tenant_id: string;
  company_id: string;
  kind: string;
  label: string;
  description: string;
  service_code: string | null;
  amount_cents: number | null;
  municipality_code: string | null;
  code: string | null;
  gtin: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unit: string | null;
  unit_price: string | null;
  csosn: string | null;
  origin: number | null;
  created_at: Date;
}

const LABEL_MAX = 80;

@Injectable()
export class TypeOrmServiceFavoriteRepository implements IServiceFavoriteRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Schema-qualified: production connections have no search_path. */
  private table(): string {
    return this.dataSource.getMetadata(ServiceFavoriteOrmEntity).tablePath;
  }

  list(
    companyId: string,
    tenantId: string,
    kind: FavoriteKind = 'service',
  ): Promise<ServiceFavorite[]> {
    const order =
      kind === 'product' ? 'lower(description), id' : 'created_at, id';
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Row[]>(
        `SELECT * FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 AND kind = $3 ORDER BY ${order}`,
        [companyId, tenantId, kind],
      );
      return rows.map((row) => this.toDomain(row));
    });
  }

  create(
    companyId: string,
    tenantId: string,
    input: NewServiceFavorite,
  ): Promise<ServiceFavorite> {
    if (input.kind === 'product')
      return this.saveProduct(companyId, tenantId, input);
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Row[]>(
        `INSERT INTO ${this.table()} (tenant_id, company_id, label, description, service_code, amount_cents, municipality_code) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          tenantId,
          companyId,
          input.label,
          input.description,
          input.serviceCode ?? null,
          input.amountCents ?? null,
          input.municipalityCode ?? null,
        ],
      );
      return this.toDomain(rows[0]);
    });
  }

  private saveProduct(
    companyId: string,
    tenantId: string,
    input: NewServiceFavorite,
  ): Promise<ServiceFavorite> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Row[]>(
        `INSERT INTO ${this.table()} (tenant_id, company_id, kind, label, description, code, gtin, ncm, cest, cfop, unit, unit_price, csosn, origin)
         VALUES ($1, $2, 'product', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (company_id, (lower(description))) WHERE kind = 'product' DO UPDATE SET
           label = EXCLUDED.label, code = EXCLUDED.code, gtin = EXCLUDED.gtin, ncm = EXCLUDED.ncm, cest = EXCLUDED.cest,
           cfop = EXCLUDED.cfop, unit = EXCLUDED.unit, unit_price = EXCLUDED.unit_price, csosn = EXCLUDED.csosn, origin = EXCLUDED.origin
         RETURNING *`,
        [
          tenantId,
          companyId,
          input.description.slice(0, LABEL_MAX),
          input.description,
          input.code ?? '',
          input.gtin ?? null,
          input.ncm ?? null,
          input.cest ?? null,
          input.cfop ?? null,
          input.unit ?? 'UN',
          input.unitPrice ?? null,
          input.csosn ?? null,
          input.origin ?? null,
        ],
      );
      return this.toDomain(rows[0]);
    });
  }

  delete(id: string, companyId: string, tenantId: string): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Array<{ id: string }>>(
        `DELETE FROM ${this.table()} WHERE id = $1 AND company_id = $2 AND tenant_id = $3 RETURNING id`,
        [id, companyId, tenantId],
      );
      // DELETE ... RETURNING resolves to [rows, affected] in the pg driver.
      const list = (Array.isArray(rows[0]) ? rows[0] : rows) as unknown[];
      return list.length > 0;
    });
  }

  private toDomain(row: Row): ServiceFavorite {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      companyId: row.company_id,
      kind: row.kind === 'product' ? 'product' : 'service',
      label: row.label,
      description: row.description,
      serviceCode: row.service_code,
      amountCents: row.amount_cents,
      municipalityCode: row.municipality_code,
      code: row.code,
      gtin: row.gtin,
      ncm: row.ncm,
      cest: row.cest,
      cfop: row.cfop,
      unit: row.unit,
      unitPrice: row.unit_price === null ? null : Number(row.unit_price),
      csosn: row.csosn,
      origin: row.origin,
      createdAt: row.created_at,
    };
  }
}
