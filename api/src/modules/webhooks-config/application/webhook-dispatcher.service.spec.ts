import { WebhookDeliveryHttpError } from '../infra/webhook-dispatcher.adapter';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

function setup(attempt: jest.Mock) {
  const configService = {
    findOne: jest.fn().mockResolvedValue({
      id: 'hook-1',
      url: 'https://example.com/hook',
      secret: 'secret',
    }),
  };
  const outboxService = {
    enqueue: jest.fn().mockResolvedValue({ id: 'delivery-1' }),
    attemptDelivery: attempt,
  };
  return new WebhookDispatcherService(
    configService as never,
    outboxService as never,
  );
}

describe('WebhookDispatcherService.test', () => {
  it('reports success when the endpoint accepts the test event', async () => {
    const service = setup(jest.fn().mockResolvedValue(undefined));

    await expect(service.test('tenant-1', 'hook-1')).resolves.toEqual({
      sent: true,
    });
  });

  it('reports the endpoint status instead of failing the request', async () => {
    const service = setup(
      jest.fn().mockRejectedValue(new WebhookDeliveryHttpError(405)),
    );

    await expect(service.test('tenant-1', 'hook-1')).resolves.toEqual({
      sent: false,
      statusCode: 405,
      error: expect.stringContaining('405') as string,
    });
  });

  it('reports network failures without a status code', async () => {
    const service = setup(
      jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    );

    await expect(service.test('tenant-1', 'hook-1')).resolves.toEqual({
      sent: false,
      statusCode: null,
      error: 'connect ECONNREFUSED',
    });
  });
});
