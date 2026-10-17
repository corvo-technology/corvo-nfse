import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { createBullmqOptions } from './redis-bullmq.options';
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
      { name: 'nfse-emission' },
      { name: 'nfse-reconciliation' },
      { name: 'nfse-doc-prep' },
      { name: 'nfse-email' },
      { name: 'nfse-fiscal-reconcile' },
      { name: 'meta-capi' },
    ),
  ],
  providers: redisProviders,
  exports: redisExports,
})
export class AppRedisModule {}
