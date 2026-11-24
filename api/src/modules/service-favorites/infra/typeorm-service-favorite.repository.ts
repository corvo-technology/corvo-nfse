import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { IServiceFavoriteRepository } from '../domain/service-favorite';
import type {
  NewServiceFavorite,
  ServiceFavorite,
} from '../domain/service-favorite';
import { ServiceFavoriteOrmEntity } from './service-favorite.orm-entity';

interface Row {
  id: string;
  tenant_id: string;
  company_id: string;
  label: string;
  description: string;
  service_code: string;
  amount_cents: number | null;
  municipality_code: string | null;
  created_at: Date;
}

@Injectable()
export class TypeOrmServiceFavoriteRepository implements IServiceFavoriteRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Schema-qualified: production connections have no search_path. */
  private table(): string {
    return this.dataSource.getMetadata(ServiceFavoriteOrmEntity).tablePath;
  }

  list(companyId: string, tenantId: string): Promise<ServiceFavorite[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Row[]>(
        `SELECT * FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 ORDER BY created_at, id`,
        [companyId, tenantId],
      );
      return rows.map((row) => this.toDomain(row));
    });
  }

  create(
    companyId: string,
    tenantId: string,
    input: NewServiceFavorite,
  ): Promise<ServiceFavorite> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.dataSource.manager.query<Row[]>(
        `INSERT INTO ${this.table()} (tenant_id, company_id, label, description, service_code, amount_cents, municipality_code) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          tenantId,
          companyId,
          input.label,
          input.description,
          input.serviceCode,
          input.amountCents,
          input.municipalityCode,
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
      label: row.label,
      description: row.description,
      serviceCode: row.service_code,
      amountCents: row.amount_cents,
      municipalityCode: row.municipality_code,
      createdAt: row.created_at,
    };
  }
}
