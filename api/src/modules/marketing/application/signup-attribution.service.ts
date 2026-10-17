import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueuePort } from '@/infra/redis/queue.port';
import type { MarketingConfig } from '@/infra/config/configuration.types';
import type { AuthContext } from '@/modules/auth/auth-context';
import { AuthUserService } from '@/modules/auth/application/auth-user.service';
import { IAuthUserAttributionRepository } from '../domain/auth-user-attribution.repository';
import type { CompleteRegistrationJobData } from '../jobs/meta-capi-job.types';

const ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONSENT_VERSION = 'v1';

export interface SignupAttributionUtm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface SignupAttributionInput {
  eventId: string;
  consent: boolean;
  consentVersion?: string;
  utm?: SignupAttributionUtm;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  landingUrl?: string;
  eventSourceUrl?: string;
}

export interface SignupAttributionRequestMeta {
  clientIp?: string;
  userAgent?: string;
}

export interface SignupAttributionResult {
  recorded: boolean;
}

@Injectable()
export class SignupAttributionService {
  private readonly logger = new Logger(SignupAttributionService.name);

  constructor(
    private readonly authUserService: AuthUserService,
    private readonly attributions: IAuthUserAttributionRepository,
    private readonly queue: QueuePort,
    private readonly config: ConfigService,
  ) {}

  async record(
    authContext: AuthContext,
    input: SignupAttributionInput,
    request: SignupAttributionRequestMeta,
  ): Promise<SignupAttributionResult> {
    if (!input.consent) return { recorded: false };

    // Only the workspace creator (tenantId === authUserId) qualifies; an
    // invited member's own workspace never exists, so this excludes them.
    if (authContext.activeTenantId !== authContext.authUserId) {
      return { recorded: false };
    }

    const user = await this.authUserService.findById(authContext.authUserId);
    if (!user) return { recorded: false };

    const ageMs = Date.now() - user.createdAt.getTime();
    if (ageMs < 0 || ageMs > ELIGIBILITY_WINDOW_MS) return { recorded: false };

    const now = new Date();
    const attribution = {
      eventId: input.eventId,
      utm: input.utm ?? {},
      fbclid: input.fbclid,
      fbc: input.fbc,
      fbp: input.fbp,
      landingUrl: input.landingUrl,
      consent: {
        granted: true,
        at: now.toISOString(),
        version: input.consentVersion ?? DEFAULT_CONSENT_VERSION,
      },
      recordedAt: now.toISOString(),
    };

    const recorded = await this.attributions.recordIfAbsent(
      user.id,
      attribution,
    );
    if (!recorded) return { recorded: false };

    await this.enqueueCompleteRegistration(user, input, request);

    return { recorded: true };
  }

  private async enqueueCompleteRegistration(
    user: { id: string; email: string; createdAt: Date },
    input: SignupAttributionInput,
    request: SignupAttributionRequestMeta,
  ): Promise<void> {
    const marketing = this.config.getOrThrow<MarketingConfig>('marketing');
    if (!marketing.capiEnabled || !marketing.pixelId || !marketing.capiToken) {
      return;
    }

    const payload: CompleteRegistrationJobData = {
      kind: 'CompleteRegistration',
      eventId: input.eventId,
      authUserId: user.id,
      email: user.email,
      eventTime: Math.floor(user.createdAt.getTime() / 1000),
      eventSourceUrl: input.eventSourceUrl,
      fbp: input.fbp,
      fbc: input.fbc,
      clientIp: request.clientIp,
      userAgent: request.userAgent,
      utm: input.utm,
    };

    try {
      await this.queue.add('meta-capi', 'CompleteRegistration', payload, {
        attempts: 5,
        backoffMs: 10_000,
        jobId: `capi:CompleteRegistration:${user.id}`,
      });
    } catch (error) {
      // A failed enqueue must never block or fail the signup-attribution response.
      this.logger.warn(
        `Meta CAPI job not enqueued for event ${input.eventId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
