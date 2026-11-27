import type { DataSource } from 'typeorm';
import { runRetentionRule } from './data-retention';
import { noticeRetentionRules } from './notice-retention';

const now = new Date('2027-01-01T07:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function fakeDataSource(matched: number) {
  const query = jest.fn((sql: string): Promise<unknown> => {
    if (sql.startsWith('SELECT count'))
      return Promise.resolve([{ n: String(matched) }]);
    return Promise.resolve([[{ id: 'x' }], 1]);
  });
  return { query, dataSource: { query } as unknown as DataSource };
}

describe('noticeRetentionRules', () => {
  const rules = noticeRetentionRules('"corvo"', now);
  const byTable = (table: string) =>
    rules.filter((rule) => rule.table === `"corvo".${table}`);

  it('cuts at 30 days for sent deliveries and 90 for failed ones, counted from now', () => {
    const [sent, failed] = byTable('webhook_deliveries');
    expect(sent.params).toEqual([new Date(now.getTime() - 30 * DAY)]);
    expect(failed.params).toEqual([new Date(now.getTime() - 90 * DAY)]);
    expect(sent.erase).toBe('payload = NULL, response_body = NULL');
    expect(failed.erase).toBeUndefined();
  });

  it('never matches deliveries that are still moving', () => {
    for (const rule of byTable('webhook_deliveries')) {
      expect(rule.where).toMatch(/status = '(sent|failed)'/);
      for (const live of ['pending', 'delayed', 'manual_retry'])
        expect(rule.where).not.toContain(live);
    }
  });

  it('erases only processed and ignored inbox rows, after 30 days', () => {
    const [paymentNotice] = byTable('webhook_events');
    const [platformNotice] = byTable('integration_events');
    expect(paymentNotice.where).toContain(`status IN ('processed','ignored')`);
    expect(platformNotice.where).toContain(`state IN ('processed','ignored')`);
    for (const rule of [paymentNotice, platformNotice]) {
      expect(rule.params).toEqual([new Date(now.getTime() - 30 * DAY)]);
      expect(rule.erase).not.toMatch(
        /provider|delivery_id|sha256|event_id|dedupe/,
      );
    }
  });

  it('touches only finished sales, after 90 days, and keeps every key', () => {
    const [sale] = byTable('integration_operations');
    expect(sale.params).toEqual([new Date(now.getTime() - 90 * DAY)]);
    expect(sale.where).toContain(
      `invoice_id IS NOT NULL AND fiscal_status = 'submitted' AND block_reason IS NULL`,
    );
    expect(sale.where).toContain(`block_reason = 'ignored_by_user'`);
    for (const attention of [
      'needs_attention',
      'refund_after_invoice',
      'cancel_requested',
      'cancel_failed',
    ])
      expect(sale.where).not.toContain(attention);
    // Only the content columns are assigned; keys are never in the SET.
    expect(sale.erase).toMatch(/^emission_request = NULL, snapshot = /);
    expect(sale.erase).not.toMatch(
      /operation_key|idempotency_key|emission_request_hash|invoice_id/,
    );
    // What a late refund and a cancel-on-refund rule need stays in the snapshot.
    for (const kept of ['externalRefs', 'commercialState', 'externalProductId'])
      expect(sale.erase).toContain(kept);
    expect(sale.erase).toContain(`'customer', 'null'::jsonb`);
  });

  it('every erasing rule stops matching a row once it is erased', () => {
    expect(byTable('webhook_deliveries')[0].where).toContain(
      'payload IS NOT NULL OR response_body IS NOT NULL',
    );
    expect(byTable('webhook_events')[0].where).toContain('payload IS NOT NULL');
    expect(byTable('integration_events')[0].where).toContain(
      `payload_enc <> ''`,
    );
    expect(byTable('integration_operations')[0].where).toContain(
      `snapshot->>'erased' IS DISTINCT FROM 'true'`,
    );
  });
});

describe('runRetentionRule with an erasing rule', () => {
  const [sent] = noticeRetentionRules('"corvo"', now);

  it('dry run only counts: no UPDATE, no DELETE', async () => {
    const { query, dataSource } = fakeDataSource(7);
    const out = await runRetentionRule(dataSource, sent, false, () => {});
    expect(out).toMatchObject({ dryRun: true, matched: 7, deleted: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('enabled runs an UPDATE ... SET, not a DELETE, for an erasing rule', async () => {
    const { query, dataSource } = fakeDataSource(1);
    const out = await runRetentionRule(dataSource, sent, true, () => {});
    expect(out).toMatchObject({ dryRun: false, matched: 1, deleted: 1 });
    const sql = query.mock.calls.map((call) => call[0]);
    expect(sql[1]).toMatch(
      /^UPDATE "corvo"\.webhook_deliveries SET payload = NULL/,
    );
    expect(sql.some((text) => text.startsWith('DELETE'))).toBe(false);
  });

  it('enabled runs a DELETE for a rule without erase', async () => {
    const { query, dataSource } = fakeDataSource(1);
    const failed = noticeRetentionRules('"corvo"', now)[1];
    await runRetentionRule(dataSource, failed, true, () => {});
    expect(query.mock.calls[1][0]).toMatch(/^DELETE FROM/);
  });
});
