import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { TypeOrmTransactionContext } from './typeorm-transaction-context';
import { observeTypeOrmTransaction } from './typeorm-telemetry';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWorkPort {
  private readonly logger = new Logger(TypeOrmUnitOfWork.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactionContext: TypeOrmTransactionContext,
  ) {}

  execute<T>(work: () => Promise<T>): Promise<T> {
    return this.run(work);
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const existingManager = this.transactionContext.getManager();
    if (existingManager) return work();

    return observeTypeOrmTransaction(async (transaction) => {
      const queryRunner = this.dataSource.createQueryRunner();
      try {
        await queryRunner.connect();
        await queryRunner.startTransaction();
        const result = await this.transactionContext.run(
          queryRunner.manager,
          work,
        );
        await queryRunner.commitTransaction();
        transaction.committed();
        return result;
      } catch (error) {
        if (!queryRunner.isReleased && queryRunner.isTransactionActive) {
          try {
            await queryRunner.rollbackTransaction();
            transaction.rolledBack();
          } catch (rollbackError) {
            transaction.rollbackFailed(rollbackError);
            this.logger.error({
              event: 'typeorm_unit_of_work_rollback_failed',
              error:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
              stack:
                rollbackError instanceof Error
                  ? rollbackError.stack
                  : undefined,
            });
          }
        }
        throw error;
      } finally {
        if (!queryRunner.isReleased) {
          await queryRunner.release();
        }
      }
    });
  }
}
