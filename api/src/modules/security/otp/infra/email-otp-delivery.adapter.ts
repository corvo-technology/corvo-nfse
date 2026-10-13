import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '@/modules/email/application/email.service';
import type { OtpPurpose } from '../domain/otp.types';
import type { OtpDeliveryAdapter } from '../application/otp-delivery.gateway';

@Injectable()
export class EmailOtpDeliveryAdapter implements OtpDeliveryAdapter {
  readonly channel = 'email' as const;
  private readonly logger = new Logger(EmailOtpDeliveryAdapter.name);

  constructor(private readonly emailService: EmailService) {}

  async send(input: {
    target: string;
    code: string;
    purpose: OtpPurpose;
    expiresAt: number;
    productKey?: string;
  }): Promise<void> {
    const expiresInMinutes = Math.round(
      (input.expiresAt - Date.now()) / 60_000,
    );

    this.logger.debug(
      `Enqueueing OTP email to ${input.target} ` +
        `(product=${input.productKey ?? 'corvo'}, ttl=${expiresInMinutes}min)`,
    );

    await this.emailService.enqueueOtp({
      to: input.target,
      code: input.code,
      expiresInMinutes,
      productKey: input.productKey ?? 'corvo',
    });
  }
}
