import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueuePort } from '@/infra/redis/queue.port';
import {
  creditsLowEmail,
  otpEmail,
  schedulePausedEmail,
  scheduleRetryEmail,
  welcomeEmail,
} from '@/infra/external/email/email-templates';
import type { RenderedEmail } from '@/infra/external/email/email-templates';
import type {
  OtpEmailJobData,
  WelcomeEmailJobData,
  CreditsLowEmailJobData,
  ScheduleRetryEmailJobData,
  SchedulePausedEmailJobData,
  NoticeEmailJobData,
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

export type EnqueueCreditsLowInput = {
  to: string;
  planName: string;
  remaining: number;
  total: number;
};

export type EnqueueScheduleRetryInput = {
  to: string;
  /** How many schedules failed this time. */
  count: number;
  /** Plain-text summary: "Acme Ltda (R$ 150,00); Beta ME (R$ 90,00)". */
  schedules: string;
  reason: string;
};

export type EnqueueSchedulePausedInput = {
  to: string;
  companyName: string;
  amount: string;
  reason: string;
};

const DEFAULT_APP_URL = 'https://www.corvo.tech/app';

/** APP_URL may be the site origin or already end with /app; the pages live under /app/... */
function appPage(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '').replace(/\/app$/, '')}/app/${path}`;
}
const billingUrl = (appUrl: string) => appPage(appUrl, 'billing');
const schedulesUrl = (appUrl: string) => appPage(appUrl, 'schedules');

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
      email: otpEmail({
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
      }),
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
      email: welcomeEmail({
        name: input.name,
        dashboardUrl: this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL,
      }),
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

  async enqueueCreditsLow(input: EnqueueCreditsLowInput): Promise<void> {
    const emailId = `credits_low_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const data: CreditsLowEmailJobData = {
      emailId,
      to: input.to,
      email: creditsLowEmail({
        planName: input.planName,
        remaining: input.remaining,
        total: input.total,
        billingUrl: billingUrl(
          this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL,
        ),
      }),
      kind: 'credits-low',
    };

    await this.queue.add('email', 'credits-low', data, {
      attempts: 3,
      backoffMs: 5_000,
      removeOnComplete: true,
      removeOnFail: 0,
    });

    this.logger.debug(`Credits-low email enqueued: ${emailId} → ${input.to}`);
  }
  async enqueueScheduleRetry(input: EnqueueScheduleRetryInput): Promise<void> {
    const emailId = `schedule_retry_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const appUrl = this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL;

    const data: ScheduleRetryEmailJobData = {
      emailId,
      to: input.to,
      email: scheduleRetryEmail({
        count: input.count,
        schedules: input.schedules,
        reason: input.reason,
        billingUrl: billingUrl(appUrl),
        schedulesUrl: schedulesUrl(appUrl),
      }),
      kind: 'schedule-retry',
    };

    await this.queue.add('email', 'schedule-retry', data, {
      attempts: 3,
      backoffMs: 5_000,
      removeOnComplete: true,
      removeOnFail: 0,
    });

    this.logger.debug(
      `Schedule retry email enqueued: ${emailId} → ${input.to}`,
    );
  }

  async enqueueSchedulePaused(
    input: EnqueueSchedulePausedInput,
  ): Promise<void> {
    const emailId = `schedule_paused_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const appUrl = this.config.get<string>('APP_URL') ?? DEFAULT_APP_URL;

    const data: SchedulePausedEmailJobData = {
      emailId,
      to: input.to,
      email: schedulePausedEmail({
        companyName: input.companyName,
        amount: input.amount,
        reason: input.reason,
        schedulesUrl: schedulesUrl(appUrl),
      }),
      kind: 'schedule-paused',
    };

    await this.queue.add('email', 'schedule-paused', data, {
      attempts: 3,
      backoffMs: 5_000,
      removeOnComplete: true,
      removeOnFail: 0,
    });

    this.logger.debug(
      `Schedule paused email enqueued: ${emailId} → ${input.to}`,
    );
  }

  /** Any ready-made e-mail (a notice built by the caller), sent through the same queue. */
  async enqueueNotice(to: string, email: RenderedEmail): Promise<void> {
    const emailId = `notice_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const data: NoticeEmailJobData = { emailId, to, email, kind: 'notice' };
    await this.queue.add('email', 'notice', data, {
      attempts: 3,
      backoffMs: 5_000,
      removeOnComplete: true,
      removeOnFail: 0,
    });
  }
}
