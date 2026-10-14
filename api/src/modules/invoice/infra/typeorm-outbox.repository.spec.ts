import { DataSource } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmOutboxRepository } from './typeorm-outbox.repository';

describe('oldestPendingAvailableAt', () => {
  it('reads only due pending messages through the data source', async () => {
    const source = new DataSource({ type: 'postgres' });
    jest
      .spyOn(source, 'getMetadata')
      .mockReturnValue({ tableName: 'outbox_messages' } as ReturnType<
        DataSource['getMetadata']
      >);
    const query = jest
      .spyOn(source, 'query')
      .mockResolvedValue([{ oldest: new Date('2026-10-13T11:00:00Z') }]);
    const repo = new TypeOrmOutboxRepository(
      source,
      new TypeOrmTransactionContext(),
    );
    const now = new Date('2026-10-13T12:00:00Z');
    await expect(repo.oldestPendingAvailableAt(now)).resolves.toEqual(
      new Date('2026-10-13T11:00:00Z'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/status = 'pending' AND available_at <= \$1/),
      [now],
    );
    query.mockResolvedValue([{ oldest: null }]);
    await expect(repo.oldestPendingAvailableAt(now)).resolves.toBeNull();
  });
});
