import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  CustomerDirectory,
  type CustomerListFilter,
  type CustomerListResult,
  type CustomerScope,
  type SavedCustomer,
} from '../domain/customer-directory';
import { CustomerOrmEntity } from './customer.orm-entity';

function toCustomer(row: CustomerOrmEntity): SavedCustomer {
  return {
    taxId: row.taxId,
    name: row.name,
    email: row.email,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** `%` and `_` typed by the user are searched literally. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class TypeOrmCustomerDirectory extends CustomerDirectory {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  private customers() {
    return this.dataSource.getRepository(CustomerOrmEntity);
  }

  async find(
    scope: CustomerScope,
    taxId: string,
  ): Promise<SavedCustomer | null> {
    const row = await runWithTenant(scope.tenantId, () =>
      this.customers().findOne({ where: { ...scope, taxId } }),
    );
    return row ? toCustomer(row) : null;
  }

  async remember(
    scope: CustomerScope,
    customer: { taxId: string; name: string; email?: string | null },
  ): Promise<void> {
    const repository = this.customers();
    // Schema-qualified and quoted, with an alias the conflict clause can refer to.
    const table = repository.metadata.tablePath
      .split('.')
      .map((part) => `"${part}"`)
      .join('.');
    await runWithTenant(scope.tenantId, () =>
      repository.query(
        `INSERT INTO ${table} AS saved (tenant_id, environment, tax_id, name, email)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, environment, tax_id) DO UPDATE SET
           name = EXCLUDED.name,
           email = COALESCE(EXCLUDED.email, saved.email),
           last_used_at = now(),
           updated_at = now()`,
        [
          scope.tenantId,
          scope.environment,
          customer.taxId,
          customer.name,
          customer.email ?? null,
        ],
      ),
    );
  }

  async list(
    scope: CustomerScope,
    filter: CustomerListFilter,
    page: { limit: number; offset: number },
  ): Promise<CustomerListResult> {
    return runWithTenant(scope.tenantId, async () => {
      const query = this.customers()
        .createQueryBuilder('c')
        .where(
          'c.tenantId = :tenantId AND c.environment = :environment',
          scope,
        );
      const search = filter.search?.trim();
      if (search) {
        const digits = search.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
        query.andWhere(
          digits
            ? `(c.name ILIKE :name ESCAPE '\\' OR c.taxId LIKE :taxId ESCAPE '\\')`
            : `c.name ILIKE :name ESCAPE '\\'`,
          {
            name: `%${escapeLike(search)}%`,
            taxId: `${escapeLike(digits)}%`,
          },
        );
      }
      const [rows, total] = await query
        .orderBy('c.lastUsedAt', 'DESC')
        .addOrderBy('c.taxId', 'ASC')
        .offset(page.offset)
        .limit(page.limit)
        .getManyAndCount();
      return { items: rows.map(toCustomer), total };
    });
  }

  async update(
    scope: CustomerScope,
    taxId: string,
    change: { name?: string; email?: string | null },
  ): Promise<SavedCustomer | null> {
    return runWithTenant(scope.tenantId, async () => {
      const row = await this.customers().findOne({
        where: { ...scope, taxId },
      });
      if (!row) return null;
      if (change.name !== undefined) row.name = change.name;
      if (change.email !== undefined) row.email = change.email;
      row.updatedAt = new Date();
      return toCustomer(await this.customers().save(row));
    });
  }

  async remove(scope: CustomerScope, taxId: string): Promise<boolean> {
    const result = await runWithTenant(scope.tenantId, () =>
      this.customers().delete({ ...scope, taxId }),
    );
    return (result.affected ?? 0) > 0;
  }
}
