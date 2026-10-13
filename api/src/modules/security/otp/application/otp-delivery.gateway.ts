import { Injectable } from '@nestjs/common';
import type { OtpChannel, OtpPurpose } from '../domain/otp.types';
import { OtpDeliveryUnavailableError } from '../domain/otp-errors';

export interface OtpDeliveryAdapter {
  readonly channel: OtpChannel;
  send(input: {
    target: string;
    code: string;
    purpose: OtpPurpose;
    expiresAt: number;
    productKey?: string;
    tenantId?: string;
    challengeId?: string;
  }): Promise<void>;
}

@Injectable()
export class OtpDeliveryGateway {
  private readonly adapters = new Map<OtpChannel, OtpDeliveryAdapter>();

  register(adapter: OtpDeliveryAdapter): void {
    this.adapters.set(adapter.channel, adapter);
  }

  unregister(channel: OtpChannel): void {
    this.adapters.delete(channel);
  }

  supports(channel: OtpChannel): boolean {
    return this.adapters.has(channel);
  }

  async send(
    channel: OtpChannel,
    input: Parameters<OtpDeliveryAdapter['send']>[0],
  ): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) throw new OtpDeliveryUnavailableError(channel);
    await adapter.send(input);
  }
}
