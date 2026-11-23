import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';

export type PlatformQuery = <R = Record<string, unknown>>(
  sql: string,
  params?: readonly unknown[],
) => Promise<R[]>;

/**
 * Cross-tenant reads for the platform admin. RLS is opened by the `platform-admin` system
 * scope, and the transaction is READ ONLY so this path can never write.
 */
@Injectable()
export class PlatformReadSession {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  run<T>(work: (q: PlatformQuery) => Promise<T>): Promise<T> {
    return runAsSystem('platform-admin', async () => {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.startTransaction();
        await runner.query('SET TRANSACTION READ ONLY');
        const q: PlatformQuery = <R>(
          sql: string,
          params: readonly unknown[] = [],
        ) => runner.query(sql, [...params]) as Promise<R[]>;
        const result = await work(q);
        await runner.commitTransaction();
        return result;
      } catch (error) {
        try {
          await runner.rollbackTransaction();
        } catch {
          // keep the original error
        }
        throw error;
      } finally {
        await runner.release();
      }
    });
  }
}
