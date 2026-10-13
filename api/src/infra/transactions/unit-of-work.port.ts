export abstract class UnitOfWorkPort {
  abstract execute<T>(work: () => Promise<T>): Promise<T>;
}

export class ImmediateUnitOfWork implements UnitOfWorkPort {
  execute<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
