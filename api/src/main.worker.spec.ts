import { resolveWorkerHealthRoute } from './main.worker';
import { captureRuntimeException } from '@/infra/observability/sentry-reporter';

jest.mock('@/infra/observability/sentry-reporter', () => ({
  captureRuntimeException: jest.fn(),
  flushSentry: jest.fn(),
}));

describe('worker health server', () => {
  const healthService = {
    getLive: jest.fn(),
    getReady: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    healthService.getLive.mockReturnValue({
      status: 'ok',
      timestamp: '2026-07-03T00:00:00.000Z',
      uptime: 1,
    });
    healthService.getReady.mockResolvedValue({
      status: 'ok',
      timestamp: '2026-07-03T00:00:00.000Z',
      uptime: 1,
      checks: {
        postgres: { status: 'ok', latencyMs: 1 },
      },
    });
  });

  it('returns live health JSON under the API prefix', async () => {
    const response = await resolveWorkerHealthRoute(
      healthService,
      'v1',
      'GET',
      '/v1/health/live',
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ status: 'ok' }));
    expect(healthService.getLive).toHaveBeenCalledTimes(1);
  });

  it('returns 404 outside health routes', async () => {
    const response = await resolveWorkerHealthRoute(
      healthService,
      'v1',
      'GET',
      '/v1/appointments',
    );

    expect(response.statusCode).toBe(404);
  });

  it('calls HealthService.getReady for readiness', async () => {
    const response = await resolveWorkerHealthRoute(
      healthService,
      '/v1/',
      'GET',
      '/v1/health/ready',
    );

    expect(response.statusCode).toBe(200);

    expect(healthService.getReady).toHaveBeenCalledTimes(1);
  });

  it('reports an unexpected readiness failure without exposing details', async () => {
    const error = new Error('postgresql://user:password@internal/db');
    healthService.getReady.mockRejectedValueOnce(error);

    const response = await resolveWorkerHealthRoute(
      healthService,
      'v1',
      'GET',
      '/v1/health/ready',
    );

    expect(captureRuntimeException).toHaveBeenCalledWith(
      error,
      'worker',
      'health_check',
    );
    expect(response).toEqual({
      statusCode: 500,
      body: { statusCode: 500, message: 'Health check failed' },
    });
    expect(JSON.stringify(response)).not.toContain('password');
  });
});
