import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EntityManager } from 'typeorm';

@Injectable()
export class TypeOrmTransactionContext {
  private readonly storage = new AsyncLocalStorage<EntityManager>();

  getManager(): EntityManager | undefined {
    return this.storage.getStore();
  }

  run<T>(manager: EntityManager, work: () => Promise<T>): Promise<T> {
    return this.storage.run(manager, work);
  }
}
