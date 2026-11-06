import { UnauthorizedException } from '@nestjs/common';
import { WooviWebhookController } from './woovi-webhook.controller';

const TOKEN = 'token-token-token-token';
function setup() {
  const payments = { handleEvent: jest.fn().mockResolvedValue(undefined) };
  const controller = new WooviWebhookController(payments as never, {
    enabled: true,
    appId: 'app',
    webhookToken: TOKEN,
    apiUrl: 'x',
  });
  return { payments, controller };
}

describe(WooviWebhookController.name, () => {
  it.each([undefined, '', 'wrong', `${TOKEN}x`, TOKEN.slice(1)])(
    'rejects authorization %p before touching payments',
    async (header) => {
      const { controller, payments } = setup();
      await expect(
        controller.receive(header as never, {
          event: 'OPENPIX:CHARGE_COMPLETED',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(payments.handleEvent).not.toHaveBeenCalled();
    },
  );
  it('accepts the configured token, with or without Bearer', async () => {
    const { controller, payments } = setup();
    const body = { event: 'OPENPIX:CHARGE_COMPLETED' };
    await expect(controller.receive(TOKEN, body)).resolves.toEqual({
      received: true,
    });
    await controller.receive(`Bearer ${TOKEN}`, body);
    expect(payments.handleEvent).toHaveBeenCalledTimes(2);
  });
  it('refuses everything when no token is configured', async () => {
    const payments = { handleEvent: jest.fn() };
    const controller = new WooviWebhookController(payments as never, {
      enabled: false,
      appId: '',
      webhookToken: '',
      apiUrl: 'x',
    });
    await expect(controller.receive('', {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
