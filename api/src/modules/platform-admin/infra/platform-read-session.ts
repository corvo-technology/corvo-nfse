import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  runAsSystem,
  runWithoutDatabaseScope,
} from '@/infra/persistence/typeorm/tenant-context.storage';

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

  async run<T>(work: (q: PlatformQuery) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    return runWithoutDatabaseScope(async () => {
      try {
        // The system scope is read when the transaction starts and lasts only for
        // this transaction (transaction-local). Everything else runs with an empty
        // scope, so any other DB access inside `work` gets no tenant and no system context.
        await runAsSystem('platform-admin', () => runner.startTransaction());
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
