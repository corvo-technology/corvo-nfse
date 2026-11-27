import { WebhookRetryScheduler } from './webhook-retry.scheduler';

describe('WebhookRetryScheduler', () => {
  it('does not start a second round while one is still running', async () => {
    let release!: () => void;
    const processNext = jest.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const scheduler = new WebhookRetryScheduler(
      { processNext } as never,
      { get: jest.fn() } as never,
    );
    const first = scheduler.handleRetries();
    await scheduler.handleRetries();
    expect(processNext).toHaveBeenCalledTimes(1);
    release();
    await first;
    const third = scheduler.handleRetries();
    release();
    await third;
    expect(processNext).toHaveBeenCalledTimes(2);
  });

  it('uses the configured interval, and only where the schedule module exists', () => {
    jest.useFakeTimers();
    try {
      const processNext = jest.fn().mockResolvedValue(undefined);
      const config = {
        get: jest.fn().mockReturnValue({ retryIntervalMs: 10_000 }),
      };
      const scheduler = new WebhookRetryScheduler(
        { processNext } as never,
        config as never,
        {} as never,
      );
      scheduler.onApplicationBootstrap();
      jest.advanceTimersByTime(9_999);
      expect(processNext).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(processNext).toHaveBeenCalledTimes(1);
      scheduler.onApplicationShutdown();

      const apiOnly = new WebhookRetryScheduler(
        { processNext } as never,
        config as never,
      );
      apiOnly.onApplicationBootstrap();
      jest.advanceTimersByTime(60_000);
      expect(processNext).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
