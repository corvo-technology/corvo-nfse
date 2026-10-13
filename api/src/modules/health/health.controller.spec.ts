import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  const healthService = {
    getLive: jest.fn(),
    getReady: jest.fn(),
  };

  beforeEach(async () => {
    healthService.getLive.mockReturnValue({
      status: 'ok',
      timestamp: '2026-06-03T00:00:00.000Z',
      uptime: 1,
    });
    healthService.getReady.mockResolvedValue({
      status: 'ok',
      timestamp: '2026-06-03T00:00:00.000Z',
      uptime: 1,
      checks: {
        postgres: { status: 'ok', latencyMs: 1 },
        redis: { status: 'ok', latencyMs: 1 },
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns an ok live health response', () => {
    const response = controller.getLive();

    expect(response.status).toBe('ok');
    expect(typeof response.timestamp).toBe('string');
    expect(typeof response.uptime).toBe('number');
  });

  it('returns readiness checks', async () => {
    await expect(controller.getReady()).resolves.toEqual(
      expect.objectContaining({
        status: 'ok',
        checks: {
          postgres: { status: 'ok', latencyMs: 1 },
          redis: { status: 'ok', latencyMs: 1 },
        },
      }),
    );
  });
});
