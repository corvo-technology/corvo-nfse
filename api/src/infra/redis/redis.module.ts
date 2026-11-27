import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { createBullmqOptions } from './redis-bullmq.options';
import { SPLIT_QUEUE_NAMES } from './queue-routing';
import { redisExports, redisProviders } from './redis.providers';

@Global()
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createBullmqOptions,
    }),
    BullModule.registerQueue(
      { name: 'email' },
      { name: 'nfse-fiscal-reconcile' },
      { name: 'import-read' },
      // Each split queue and its `-test` twin (see queue-routing.ts).
      ...SPLIT_QUEUE_NAMES.map((name) => ({ name })),
    ),
  ],
  providers: redisProviders,
  exports: redisExports,
})
export class AppRedisModule {}
