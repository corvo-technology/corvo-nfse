import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueuePort } from '@/infra/redis/queue.port';
import type {
  OtpEmailJobData,
  WelcomeEmailJobData,
} from '@/infra/queues/email-job.types';

export type EnqueueOtpInput = {
  to: string;
  code: string;
  expiresInMinutes: number;
  productKey: string;
};

export type EnqueueWelcomeInput = {
  to: string;
  name: string;
};

const DEFAULT_APP_URL = 'https://corvo.tech/app';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly queue: QueuePort,
    private readonly config: ConfigService,
  ) {}

  async enqueueOtp(input: EnqueueOtpInput): Promise<void> {
    const emailId = `otp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const data: OtpEmailJobData = {
      emailId,
      to: input.to,
      template: {
        alias: 'otp-code',
        variables: {
          code: input.code,
          expires_in_minutes: String(input.expiresInMinutes),
        },
      },
      kind: 'otp',
      code: input.code,
      expiresInMinutes: input.expiresInMinutes,
      productKey: input.productKey,
    };

    await this.queue.add('email', 'otp', data, {
      attempts: 3,
      backoffMs: 5_000,
      removeOnComplete: true,
      removeOnFail: 0,
    });

    this.logger.debug(`OTP email enqueued: ${emailId} → ${input.to}`);
  }

  async enqueueWelcome(input: EnqueueWelcomeInput): Promise<void> {
    const emailId = `welcome_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const data: WelcomeEmailJobData = {
      emailId,
      to: input.to,
      template: {
        alias: 'welcome',
        variables: {
          user_name: input.name,
          dashboard_url: this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL,
        },
      },
      kind: 'welcome',
    };

    await this.queue.add('email', 'welcome', data, {
      attempts: 3,
      backoffMs: 5_000,
      removeOnComplete: true,
      removeOnFail: 0,
    });

    this.logger.debug(`Welcome email enqueued: ${emailId} → ${input.to}`);
  }
}
