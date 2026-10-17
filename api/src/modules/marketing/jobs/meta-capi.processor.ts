import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  MetaCapiClient,
  MetaCapiUnrecoverableError,
} from '../application/meta-capi.client';
import { buildMetaUserData } from '../domain/meta-user-data';
import type { CompleteRegistrationJobData } from './meta-capi-job.types';

@Processor('meta-capi')
@Injectable()
export class MetaCapiProcessor extends WorkerHost {
  private readonly logger = new Logger(MetaCapiProcessor.name);

  constructor(private readonly client: MetaCapiClient) {
    super();
  }

  async process(job: Job<CompleteRegistrationJobData>): Promise<void> {
    const { data } = job;
    try {
      await this.client.send({
        event_name: data.kind,
        event_time: data.eventTime,
        event_id: data.eventId,
        action_source: 'website',
        event_source_url: data.eventSourceUrl,
        user_data: buildMetaUserData({
          email: data.email,
          authUserId: data.authUserId,
          fbp: data.fbp,
          fbc: data.fbc,
          clientIp: data.clientIp,
          userAgent: data.userAgent,
        }),
        custom_data: data.utm,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Meta CAPI event ${data.eventId} failed on attempt ${job.attemptsMade + 1}: ${message}`,
      );
      if (error instanceof MetaCapiUnrecoverableError) {
        throw new UnrecoverableError(message);
      }
      throw error;
    }
  }

  /** Fires on every failed attempt; only the last one is worth an error-level log. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<CompleteRegistrationJobData> | undefined): void {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    this.logger.error(
      `Meta CAPI event ${job.data.eventId} permanently failed after ${job.attemptsMade} attempts`,
    );
  }
}
