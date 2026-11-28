import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { IProductFavoriteRepository } from '../domain/product-favorite';
import type {
  NewProductFavorite,
  ProductFavorite,
} from '../domain/product-favorite';
import { ProductFavoriteOrmEntity } from './product-favorite.orm-entity';

interface Row {
  id: string;
  tenant_id: string;
  company_id: string;
  description: string;
  code: string;
  gtin: string | null;
  ncm: string;
  cest: string | null;
  cfop: string | null;
  unit: string;
  unit_price: string;
  csosn: string | null;
  origin: number | null;
  created_at: Date;
}

@Injectable()
export class TypeOrmProductFavoriteRepository implements IProductFavoriteRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Schema-qualified: production connections have no search_path. */
  private table(): string {
    return this.dataSource.getMetadata(ProductFavoriteOrmEntity).tablePath;
  }

  list(companyId: string, tenantId: string): Promise<ProductFavorite[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Row[]>(
        `SELECT * FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 ORDER BY lower(description), id`,
        [companyId, tenantId],
      );
      return rows.map((row) => this.toDomain(row));
    });
  }

  save(
    companyId: string,
    tenantId: string,
    input: NewProductFavorite,
  ): Promise<ProductFavorite> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Row[]>(
        `INSERT INTO ${this.table()} (tenant_id, company_id, description, code, gtin, ncm, cest, cfop, unit, unit_price, csosn, origin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (company_id, (lower(description))) DO UPDATE SET
           code = EXCLUDED.code, gtin = EXCLUDED.gtin, ncm = EXCLUDED.ncm, cest = EXCLUDED.cest, cfop = EXCLUDED.cfop,
           unit = EXCLUDED.unit, unit_price = EXCLUDED.unit_price, csosn = EXCLUDED.csosn, origin = EXCLUDED.origin
         RETURNING *`,
        [
          tenantId,
          companyId,
          input.description,
          input.code,
          input.gtin,
          input.ncm,
          input.cest,
          input.cfop,
          input.unit,
          input.unitPrice,
          input.csosn,
          input.origin,
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

  private toDomain(row: Row): ProductFavorite {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      companyId: row.company_id,
      description: row.description,
      code: row.code,
      gtin: row.gtin,
      ncm: row.ncm,
      cest: row.cest,
      cfop: row.cfop,
      unit: row.unit,
      unitPrice: Number(row.unit_price),
      csosn: row.csosn,
      origin: row.origin,
      createdAt: row.created_at,
    };
  }
}
