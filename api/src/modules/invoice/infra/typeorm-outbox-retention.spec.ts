import type { DataSource } from 'typeorm';
import { runRetentionRule } from '@/infra/retention/data-retention';
import {
  TypeOrmOutboxRetention,
  outboxRetentionRules,
} from './typeorm-outbox-retention';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-12-01T07:00:00Z');

describe('outboxRetentionRules', () => {
  const rules = outboxRetentionRules('"corvo"', now);

  it('keeps 14 days of completed, 90 of dead and 3 of test', () => {
    expect(rules.map((r) => (r.params[0] as Date).getTime())).toEqual([
      now.getTime() - 14 * DAY,
      now.getTime() - 90 * DAY,
      now.getTime() - 3 * DAY,
    ]);
  });

  it('a row of 13 days is newer than the cutoff, one of 15 days is older', () => {
    const cutoff = rules[0].params[0] as Date;
    expect(now.getTime() - 13 * DAY).toBeGreaterThan(cutoff.getTime());
    expect(now.getTime() - 15 * DAY).toBeLessThan(cutoff.getTime());
  });

  it('only ever selects finished rows, never pending or claimed', () => {
    for (const rule of rules) {
      const outer = rule.where.split('NOT EXISTS')[0];
      expect(outer).toMatch(/status (=|IN) /);
      expect(outer).not.toContain('pending');
      expect(outer).not.toContain('claimed');
    }
  });

  it('keeps finished rows whose aggregate still has a message in flight', () => {
    for (const rule of rules) {
      expect(rule.where).toContain("live.status IN ('pending','claimed')");
    }
  });
});

describe('runRetentionRule', () => {
  const rule = outboxRetentionRules('"corvo"', now)[0];
  const dataSource = (matched: number, batches: number[]) => {
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('SELECT count'))
        return Promise.resolve([{ n: String(matched) }]);
      const size = batches.shift() ?? 0;
      return Promise.resolve(Array.from({ length: size }, () => ({ id: 'x' })));
    });
    return { query, db: { query } as unknown as DataSource };
  };

  it('dry run counts and deletes nothing', async () => {
    const { query, db } = dataSource(5, [5]);
    const out = await runRetentionRule(db, rule, false, () => undefined);
    expect(out).toMatchObject({ dryRun: true, matched: 5, deleted: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('deletes in batches until a short batch', async () => {
    const { query, db } = dataSource(25, [10, 10, 5]);
    const log = jest.fn();
    const out = await runRetentionRule(db, rule, true, log, {
      batchSize: 10,
      maxBatches: 100,
    });
    expect(out).toMatchObject({ dryRun: false, matched: 25, deleted: 25 });
    expect(query).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledWith(out);
  });

  it('stops at the cap per run', async () => {
    const { query, db } = dataSource(1000, [10, 10, 10, 10]);
    const out = await runRetentionRule(db, rule, true, () => undefined, {
      batchSize: 10,
      maxBatches: 2,
    });
    expect(out.deleted).toBe(20);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('does not delete when nothing matches', async () => {
    const { query, db } = dataSource(0, []);
    await runRetentionRule(db, rule, true, () => undefined);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('TypeOrmOutboxRetention', () => {
  const build = () => {
    const query = jest.fn((sql: string) =>
      Promise.resolve(sql.startsWith('SELECT count') ? [{ n: '3' }] : []),
    );
    const db = {
      query,
      options: { schema: 'corvo' },
      driver: { escape: (s: string) => `"${s}"` },
    } as unknown as DataSource;
    return { query, scheduler: new TypeOrmOutboxRetention(db) };
  };

  it('is a dry run by default: eight counts (outbox and notices), no delete, no update', async () => {
    const { query, scheduler } = build();
    await scheduler.purge(false, now);
    expect(query).toHaveBeenCalledTimes(8);
    expect(query.mock.calls.some(([sql]) => /^(DELETE|UPDATE)/.test(sql))).toBe(
      false,
    );
  });

  it('when enabled, deletes outbox rows and old failed notices, and erases the content of the others', async () => {
    const { query, scheduler } = build();
    await scheduler.purge(true, now);
    const starts = (word: string) =>
      query.mock.calls.filter(([sql]) => sql.startsWith(word)).length;
    expect(starts('DELETE')).toBe(4);
    expect(starts('UPDATE')).toBe(4);
  });
});
