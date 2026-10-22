import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns a simple liveness response', () => {
    const service = new HealthService();
    const response = service.getLive();

    expect(response.status).toBe('ok');
    expect(typeof response.timestamp).toBe('string');
    expect(typeof response.uptime).toBe('number');
  });

});
