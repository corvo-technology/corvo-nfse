import { ConfigService } from '@nestjs/config';
import { RedisConfig } from '@/infra/config/configuration';

export function createBullmqOptions(configService: ConfigService) {
  const redis = configService.getOrThrow<RedisConfig>('redis');

  return {
    connection: {
      url: redis.url,
      maxRetriesPerRequest: null,
    },
    prefix: `${redis.keyPrefix}:queue`,
  };
}
