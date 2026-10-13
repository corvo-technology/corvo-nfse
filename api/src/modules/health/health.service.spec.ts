import { HealthService } from './health.service';

describe('HealthService', () => {
  function createService(overrides: Record<string, unknown> = {}) {
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const redis = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };
    const config = {
      app: {
        nodeEnv: 'production',
      },
      whatsapp: {
        webhookVerifyToken: 'whatsapp-verify-token',
      },
      meta: {
        graphApiBaseUrl: 'https://graph.facebook.com',
        graphApiVersion: 'v20.0',
        secretsEncryptionKey: 'secrets-key',
      },
      storage: {
        provider: 's3',
        s3Bucket: 'tenant-assets',
        s3Endpoint: 'https://storage.greenflow.test',
        s3Region: 'auto',
        s3AccessKeyId: 'access-key',
        s3SecretAccessKey: 'secret-key',
        s3ForcePathStyle: true,
        publicBaseUrl: 'https://cdn.greenflow.test',
      },
      ...overrides,
    };
    const configService = {
      getOrThrow: jest.fn((key: string) => config[key as keyof typeof config]),
    };

    return {
      service: new HealthService(
        dataSource as never,
        redis as never,
        configService as never,
      ),
      dataSource,
      redis,
      config,
      configService,
    };
  }

  it('returns liveness without dependency checks', () => {
    const { service } = createService();
    const response = service.getLive();

    expect(response.status).toBe('ok');
    expect(typeof response.timestamp).toBe('string');
    expect(typeof response.uptime).toBe('number');
  });

  it('returns ok readiness when dependencies and required configs are valid', async () => {
    const { service } = createService();
    const response = await service.getReady();

    expect(response.status).toBe('ok');
    expect(response.checks?.postgres.status).toBe('ok');
    expect(response.checks?.redis.status).toBe('ok');
    expect(response.checks?.meta.status).toBe('ok');
    expect(response.checks?.storage.status).toBe('ok');
  });

  it('returns degraded readiness when redis fails', async () => {
    const { service, redis } = createService();
    redis.ping.mockRejectedValue(new Error('redis unavailable'));
    const response = await service.getReady();

    expect(response.status).toBe('degraded');
    expect(response.checks?.redis.status).toBe('error');
    expect(response.checks?.redis.error).toBe('redis unavailable');
  });

  it('returns degraded readiness when postgres fails', async () => {
    const { service, dataSource } = createService();
    dataSource.query.mockRejectedValue(new Error('postgres unavailable'));
    const response = await service.getReady();

    expect(response.status).toBe('degraded');
    expect(response.checks?.postgres.status).toBe('error');
    expect(response.checks?.postgres.error).toBe('postgres unavailable');
  });

  it('returns degraded readiness in production when storage is unavailable', async () => {
    const { service } = createService({
      storage: {
        provider: 'unavailable',
        s3Bucket: 'tenant-assets',
        s3Region: 'auto',
        s3ForcePathStyle: true,
      },
    });
    const response = await service.getReady();

    expect(response.status).toBe('degraded');
    expect(response.checks?.storage.status).toBe('error');
    expect(response.checks?.storage.error).toBe(
      'storage requires STORAGE_PROVIDER=s3 in production',
    );
  });
});
