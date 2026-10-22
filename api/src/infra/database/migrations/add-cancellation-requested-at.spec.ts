import type { QueryRunner } from 'typeorm';
import { AddCancellationRequestedAt1792410000000 } from './1792410000000-AddCancellationRequestedAt';

function fakeRunner() {
  const queries: string[] = [];
  const runner = {
    connection: {
      options: { schema: 'corvo' },
      driver: { escape: (v: string) => `"${v}"` },
    },
    query: jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve(undefined);
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

describe('AddCancellationRequestedAt', () => {
  it('up adds the nullable cancellation_requested_at timestamptz column', async () => {
    const { runner, queries } = fakeRunner();
    await new AddCancellationRequestedAt1792410000000().up(runner);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(
      /"corvo"\.nfse_invoices\s+ADD COLUMN cancellation_requested_at timestamptz/,
    );
    expect(queries[0]).not.toMatch(/NOT NULL/i);
  });

  it('down drops the column', async () => {
    const { runner, queries } = fakeRunner();
    await new AddCancellationRequestedAt1792410000000().down(runner);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(
      /"corvo"\.nfse_invoices\s+DROP COLUMN cancellation_requested_at/,
    );
  });
});
