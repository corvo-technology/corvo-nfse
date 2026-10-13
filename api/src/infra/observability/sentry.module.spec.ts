import { ConfigService } from '@nestjs/config';
import { flushSentry } from './sentry-reporter';
import { SentryLifecycleService, SentryModule } from './sentry.module';

jest.mock('./sentry-reporter', () => ({
  flushSentry: jest.fn().mockResolvedValue(true),
}));

describe('SentryModule', () => {
  it('wraps the SDK as a root module for a runtime', () => {
    const module = SentryModule.forRoot('worker');

    expect(module.module).toBe(SentryModule);
    expect(module.providers).toEqual(
      expect.arrayContaining([SentryLifecycleService]),
    );
  });

  it('flushes pending events on application shutdown', async () => {
    const configService = new ConfigService({
      sentry: { flushTimeoutMs: 3500 },
    });
    const service = new SentryLifecycleService('api', configService);

    await service.onApplicationShutdown();

    expect(flushSentry).toHaveBeenCalledWith(3500);
  });
});
