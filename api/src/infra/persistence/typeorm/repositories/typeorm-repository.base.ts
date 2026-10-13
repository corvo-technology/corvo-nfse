import { DataSource, EntityManager, EntityTarget, Repository } from 'typeorm';
import { TypeOrmTransactionContext } from '../typeorm-transaction-context';
import { instrumentTypeOrmRepository } from '../typeorm-telemetry';

export abstract class TypeOrmRepositoryBase {
  protected constructor(
    private readonly dataSource: DataSource,
    private readonly transactionContext: TypeOrmTransactionContext,
  ) {}

  protected repository<Entity extends object>(
    target: EntityTarget<Entity>,
  ): Repository<Entity> {
    return instrumentTypeOrmRepository(this.manager().getRepository(target));
  }

  protected manager(): EntityManager {
    const manager =
      this.transactionContext.getManager() ?? this.dataSource.manager;
    return manager;
  }
}
