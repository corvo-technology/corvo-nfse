import { EventProcessorService } from './event-processor.service';
import {
  IIntegrationEventRepository,
  type ClaimedEvent,
  type EventResult,
} from '../domain/integration-event.repository';
import type { EventHandler, EventOutcome } from './event-handler';

const claimed = (over: Partial<ClaimedEvent> = {}): ClaimedEvent => ({
  id: 'e1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  connectionId: 'c1',
  provider: 'fake',
  payloadEnc: 'enc',
  attempts: 1,
  claimToken: 'tok',
  ...over,
});

class FakeRepo extends IIntegrationEventRepository {
  queue: ClaimedEvent[] = [];
  results: Array<{ id: string; result: EventResult }> = [];
  markOk = true;
  insertReceived() {
    return Promise.resolve({ id: '', created: true });
  }
  claimBatch() {
    const q = this.queue;
    this.queue = [];
    return Promise.resolve(q);
  }
  markResult(claim: { id: string }, result: EventResult) {
    this.results.push({ id: claim.id, result });
    return Promise.resolve(this.markOk);
  }
}

function run(
  events: ClaimedEvent[],
  handle: (e: ClaimedEvent) => Promise<EventOutcome>,
  repo = new FakeRepo(),
) {
  repo.queue = events;
  const handler: EventHandler = { handle };
  const service = new EventProcessorService(repo, handler);
  service.random = () => 0.5;
  return { service, repo };
}

describe('EventProcessorService', () => {
  it('stores the handler outcome with the operation id', async () => {
    const { service, repo } = run([claimed()], () =>
      Promise.resolve({ state: 'processed', operationId: 'op1' }),
    );
    await expect(service.runOnce(new Date())).resolves.toBe(1);
    expect(repo.results[0].result).toMatchObject({
      state: 'processed',
      operationId: 'op1',
    });
  });

  it('moves to retry_pending with the computed delay when the handler throws', async () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const { service, repo } = run([claimed({ attempts: 2 })], () =>
      Promise.reject(new Error('platform 503')),
    );
    await service.runOnce(now);
    const { result } = repo.results[0];
    expect(result).toMatchObject({
      state: 'retry_pending',
      lastError: 'platform 503',
    });
    expect(result.nextAttemptAt!.getTime() - now.getTime()).toBe(20_000);
  });

  it('moves to dead on the 8th failed attempt', async () => {
    const { service, repo } = run([claimed({ attempts: 8 })], () =>
      Promise.reject(new Error('still failing')),
    );
    await service.runOnce(new Date());
    expect(repo.results[0].result).toMatchObject({
      state: 'dead',
      lastError: 'still failing',
    });
  });

  it('keeps processing the remaining events when one fails', async () => {
    const { service, repo } = run(
      [claimed({ id: 'a' }), claimed({ id: 'b' })],
      (e) =>
        e.id === 'a'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ state: 'processed' }),
    );
    await expect(service.runOnce(new Date())).resolves.toBe(2);
    expect(repo.results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('truncates the stored error', async () => {
    const { service, repo } = run([claimed()], () =>
      Promise.reject(new Error('x'.repeat(2000))),
    );
    await service.runOnce(new Date());
    expect(repo.results[0].result.lastError).toHaveLength(500);
  });

  it('does not throw when markResult reports a lost claim', async () => {
    const repo = new FakeRepo();
    repo.markOk = false;
    const { service } = run(
      [claimed()],
      () => Promise.resolve({ state: 'processed' }),
      repo,
    );
    await expect(service.runOnce(new Date())).resolves.toBe(1);
  });
});
