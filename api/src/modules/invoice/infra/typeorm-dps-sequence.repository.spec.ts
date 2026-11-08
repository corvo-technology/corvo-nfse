import { NotFoundException } from '@nestjs/common';
import {
  initialDpsNumber,
  TypeOrmDpsSequenceRepository,
} from './typeorm-dps-sequence.repository';

const TENANT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';

describe('initialDpsNumber', () => {
  it('starts a test company at a random high number, so installations sharing a CNPJ do not meet', () => {
    expect(initialDpsNumber('test', () => 483_920_117)).toBe(483_920_117);
    const asked: number[][] = [];
    initialDpsNumber('test', (min, max) => (asked.push([min, max]), min));
    expect(asked).toEqual([[100_000, 900_000_000]]);
  });

  it('keeps the range well inside the 15 digits a DPS number may have', () => {
    for (let i = 0; i < 1000; i++) {
      const n = initialDpsNumber('test');
      expect(n).toBeGreaterThanOrEqual(100_000);
      expect(n).toBeLessThan(900_000_000);
    }
  });

  it('starts a live company at 0: its numbering is set to continue what it issued before', () => {
    expect(initialDpsNumber('live', () => 999)).toBe(0);
  });
});

function build() {
  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
  };
  const dataSource = {
    getMetadata: jest.fn(() => ({ tablePath: 't' })),
    createQueryRunner: jest.fn(() => queryRunner),
    query: jest.fn(),
  };
  return {
    repo: new TypeOrmDpsSequenceRepository(dataSource as never),
    queryRunner,
    dataSource,
  };
}

describe('TypeOrmDpsSequenceRepository', () => {
  it('creates the numbering of a test company at the random start, then hands out the next number', async () => {
    const { repo, queryRunner } = build();
    queryRunner.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[{ series: '1', current_number: '500001' }], 1]);
    await expect(repo.reserveNext(COMPANY, TENANT, 'test')).resolves.toEqual({
      series: '1',
      number: 500001,
    });
    const [, params] = queryRunner.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBeGreaterThanOrEqual(100_000);
  });

  it('creates the numbering of a live company at 0', async () => {
    const { repo, queryRunner } = build();
    queryRunner.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[{ series: '1', current_number: '1' }], 1]);
    await repo.reserveNext(COMPANY, TENANT, 'live');
    const [, params] = queryRunner.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe(0);
  });

  it('only reads the numbering: opening the screen must not create the row and lose the random start', async () => {
    const { repo, dataSource, queryRunner } = build();
    dataSource.query.mockResolvedValue([{ series: '1', current_number: '0' }]);
    await expect(repo.current(COMPANY, TENANT, 'test')).resolves.toEqual({
      series: '1',
      lastNumber: 0,
    });
    expect(queryRunner.query).not.toHaveBeenCalled();
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('answers not found for a company of another tenant or environment', async () => {
    const { repo, dataSource } = build();
    dataSource.query.mockResolvedValue([]);
    await expect(repo.current(COMPANY, TENANT, 'live')).rejects.toThrow(
      NotFoundException,
    );
  });
});
