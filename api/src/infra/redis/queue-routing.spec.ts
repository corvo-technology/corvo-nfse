import {
  queueFor,
  queuesHolding,
  SPLIT_QUEUE_NAMES,
  SPLIT_QUEUES,
  testTwinOf,
} from './queue-routing';

describe('queue routing', () => {
  it.each(SPLIT_QUEUES)(
    '%s: live goes to the base queue, test to the twin',
    (q) => {
      expect(queueFor(q, 'live')).toBe(q);
      expect(queueFor(q, 'test')).toBe(`${q}-test`);
      expect(testTwinOf(q)).toBe(`${q}-test`);
    },
  );

  it('lists every base queue and every twin once', () => {
    expect(new Set(SPLIT_QUEUE_NAMES).size).toBe(SPLIT_QUEUES.length * 2);
  });

  it('looks for a test job in the twin and in the old shared queue (jobs from before the split)', () => {
    expect(queuesHolding('nfse-email', 'test')).toEqual([
      'nfse-email-test',
      'nfse-email',
    ]);
    expect(queuesHolding('nfse-email', 'live')).toEqual(['nfse-email']);
  });
});
