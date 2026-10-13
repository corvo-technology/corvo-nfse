import {
  DynamicModule,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { SentryModule as NestSentryModule } from '@sentry/nestjs/setup';
import type { SentryConfig } from '@/infra/config/configuration.types';
import { flushSentry } from './sentry-reporter';
import type { SentryRuntime } from './sentry-reporter';

const SENTRY_RUNTIME = Symbol('SENTRY_RUNTIME');

@Injectable()
export class SentryLifecycleService implements OnApplicationShutdown {
  constructor(
    @Inject(SENTRY_RUNTIME) private readonly runtime: SentryRuntime,
    private readonly configService: ConfigService,
  ) {
    Sentry.getGlobalScope().setTag('runtime', runtime);
  }

  async onApplicationShutdown(): Promise<void> {
    const config = this.configService.get<SentryConfig>('sentry');
    await flushSentry(config?.flushTimeoutMs);
  }
}

@Module({})
export class SentryModule {
  static forRoot(runtime: Exclude<SentryRuntime, 'canary'>): DynamicModule {
    return {
      module: SentryModule,
      imports: [NestSentryModule.forRoot()],
      providers: [
        { provide: SENTRY_RUNTIME, useValue: runtime },
        SentryLifecycleService,
      ],
    };
  }
}
