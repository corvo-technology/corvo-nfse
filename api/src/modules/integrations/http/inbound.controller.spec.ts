import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  InboundController,
  MAX_INBOUND_BODY_BYTES,
} from './inbound.controller';
import type { InboundReceiverService } from '../application/inbound-receiver.service';

function setup() {
  const receive = jest.fn().mockResolvedValue({ status: 'accepted' });
  const controller = new InboundController({
    receive,
  } as unknown as InboundReceiverService);
  return { controller, receive };
}

describe('InboundController', () => {
  it('passes raw body, lowercase headers and string query values to the receiver', async () => {
    const { controller, receive } = setup();
    const rawBody = Buffer.from('{}');
    await expect(
      controller.receive('pub', {
        rawBody,
        headers: { 'x-sig': 'abc', multi: ['a', 'b'] },
        query: { token: 't', list: ['x'] },
      } as never),
    ).resolves.toEqual({ received: true });
    expect(receive).toHaveBeenCalledWith('pub', {
      rawBody,
      headers: { 'x-sig': 'abc', multi: 'a, b' },
      query: { token: 't' },
    });
  });

  it('returns 413 above 256 KB before calling the connector', async () => {
    const { controller, receive } = setup();
    const rawBody = Buffer.alloc(MAX_INBOUND_BODY_BYTES + 1);
    await expect(
      controller.receive('pub', { rawBody, headers: {}, query: {} } as never),
    ).rejects.toThrow(PayloadTooLargeException);
    expect(receive).not.toHaveBeenCalled();
  });

  it('returns 400 when the raw body is missing', async () => {
    const { controller } = setup();
    await expect(
      controller.receive('pub', { headers: {}, query: {} } as never),
    ).rejects.toThrow(BadRequestException);
  });
});
