/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-return */
import { DataSource, EntityManager } from 'typeorm';
import { TypeOrmTransactionContext } from './typeorm-transaction-context';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

describe('TypeOrmUnitOfWork', () => {
  function createService() {
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {} as EntityManager,
      isReleased: false,
      isTransactionActive: false,
    };
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as jest.Mocked<DataSource>;
    const transactionContext = {
      getManager: jest.fn(),
      run: jest.fn(async (_manager, work) => work()),
    } as unknown as jest.Mocked<TypeOrmTransactionContext>;
    const unitOfWork = new TypeOrmUnitOfWork(dataSource, transactionContext);
    return { unitOfWork, dataSource, transactionContext, queryRunner };
  }

  it('wraps work in a database transaction', async () => {
    const { unitOfWork, queryRunner, transactionContext } = createService();
    transactionContext.getManager.mockReturnValue(undefined);

    await expect(unitOfWork.execute(async () => 'ok')).resolves.toBe('ok');

    expect(queryRunner.connect).toHaveBeenCalledTimes(1);
    expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back when work fails', async () => {
    const { unitOfWork, queryRunner, transactionContext } = createService();
    transactionContext.getManager.mockReturnValue(undefined);
    queryRunner.isTransactionActive = true;

    await expect(
      unitOfWork.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(queryRunner.connect).toHaveBeenCalledTimes(1);
    expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('does not roll back or release when work fails after the runner is released', async () => {
    const { unitOfWork, queryRunner, transactionContext } = createService();
    transactionContext.getManager.mockReturnValue(undefined);
    queryRunner.isTransactionActive = true;

    await expect(
      unitOfWork.execute(async () => {
        queryRunner.isReleased = true;
        throw new Error('original failure');
      }),
    ).rejects.toThrow('original failure');

    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).not.toHaveBeenCalled();
  });

  it('preserves the original error when rollback fails', async () => {
    const { unitOfWork, queryRunner, transactionContext } = createService();
    transactionContext.getManager.mockReturnValue(undefined);
    queryRunner.isTransactionActive = true;
    queryRunner.rollbackTransaction.mockRejectedValue(
      new Error('rollback failed'),
    );

    await expect(
      unitOfWork.execute(async () => {
        throw new Error('original failure');
      }),
    ).rejects.toThrow('original failure');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('releases the runner when connect fails', async () => {
    const { unitOfWork, queryRunner, transactionContext } = createService();
    transactionContext.getManager.mockReturnValue(undefined);
    queryRunner.connect.mockRejectedValue(new Error('connect failed'));

    await expect(unitOfWork.execute(async () => 'unused')).rejects.toThrow(
      'connect failed',
    );

    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('releases the runner when starting the transaction fails', async () => {
    const { unitOfWork, queryRunner, transactionContext } = createService();
    transactionContext.getManager.mockReturnValue(undefined);
    queryRunner.startTransaction.mockRejectedValue(new Error('start failed'));

    await expect(unitOfWork.execute(async () => 'unused')).rejects.toThrow(
      'start failed',
    );

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
