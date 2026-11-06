import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type {
  AppConfig,
  AppConfiguration,
  TurnstileConfig,
} from '@/infra/config/configuration';
import type { PublicCustomerSessionConfig } from '@/infra/config/configuration.types';
import { CookiePolicyService } from '@/modules/auth/application/cookie-policy.service';
import { extractCookie } from '@/modules/auth/application/cookie-reader';
import {
  type TurnstileAttestation,
  TurnstileAttestationService,
} from '../application/turnstile-attestation.service';
import { recordHumanProofEvent } from '../observability/security.metrics';
import { TurnstileVerificationService } from '../application/turnstile-verification.service';
import { resolveClientIp } from '@/shared/http/client-ip';

export type HumanProofAction =
  | 'login'
  | 'signup'
  | 'booking'
  | 'waitlist'
  | 'customer_access'
  | 'appointment_cancel'
  | 'appointment_reschedule'
  | 'otp_issue';
export type HumanProofEnforcement = 'always' | 'public_customer_session';

const INLINE_TURNSTILE_ACTIONS = new Set<HumanProofAction>([
  'booking',
  'waitlist',
  'customer_access',
  'appointment_cancel',
  'appointment_reschedule',
]);

type HumanProofRequirement = {
  action: HumanProofAction;
  slugParam?: string;
  enforcement: HumanProofEnforcement;
};

type HumanProofRequest = {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  params?: Record<string, string>;
  ip?: string;
};

const HUMAN_PROOF_KEY = 'greenflow:human-proof';

export const RequireHumanProof = (
  action: HumanProofAction,
  options: {
    slugParam?: string;
    enforcement?: HumanProofEnforcement;
  } = {},
) =>
  SetMetadata(HUMAN_PROOF_KEY, {
    action,
    slugParam: options.slugParam,
    enforcement: options.enforcement ?? 'always',
  } satisfies HumanProofRequirement);

@Injectable()
export class TurnstileProofGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly attestations: TurnstileAttestationService,
    private readonly turnstile: TurnstileVerificationService,
    private readonly cookies: CookiePolicyService,
    private readonly config: ConfigService<AppConfiguration>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<HumanProofRequirement>(
      HUMAN_PROOF_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    if (this.isDevelopmentBypassEnabled()) {
      recordHumanProofEvent('proof_bypassed', requirement.action);
      return true;
    }

    if (this.isRolloutBypassEnabled(requirement)) {
      recordHumanProofEvent('proof_rollout_bypassed', requirement.action);
      return true;
    }

    const request = context.switchToHttp().getRequest<HumanProofRequest>();
    if (await this.validateInlineProof(requirement, request)) return true;

    const token = extractCookie(
      request,
      this.cookies.name(`human_${requirement.action}`),
    );
    if (!token) {
      recordHumanProofEvent('proof_missing', requirement.action);
      throw new ForbiddenException({
        code: 'HUMAN_VERIFICATION_REQUIRED',
        message: 'Human verification required',
      });
    }

    let proof: TurnstileAttestation | null;
    try {
      proof = await this.attestations.consume(token);
    } catch {
      recordHumanProofEvent('proof_rejected', requirement.action);
      throw new ServiceUnavailableException({
        code: 'HUMAN_VERIFICATION_UNAVAILABLE',
        message: 'Human verification is temporarily unavailable',
      });
    }
    const expectedSlug = requirement.slugParam
      ? request.params?.[requirement.slugParam]
      : undefined;
    if (
      !proof ||
      proof.action !== requirement.action ||
      (expectedSlug !== undefined && proof.slug !== expectedSlug)
    ) {
      recordHumanProofEvent('proof_rejected', requirement.action);
      throw new ForbiddenException({
        code: 'HUMAN_VERIFICATION_INVALID',
        message: 'Invalid or expired human verification',
      });
    }
    recordHumanProofEvent(
      INLINE_TURNSTILE_ACTIONS.has(requirement.action)
        ? 'legacy_proof_consumed'
        : 'proof_consumed',
      requirement.action,
      proof.productKey,
    );
    return true;
  }

  private isDevelopmentBypassEnabled(): boolean {
    const app = this.config.get<AppConfig>('app');
    const turnstile = this.config.get<TurnstileConfig>('turnstile');
    return (
      app?.nodeEnv === 'development' &&
      turnstile?.developmentBypassEnabled === true
    );
  }

  private async validateInlineProof(
    requirement: HumanProofRequirement,
    request: HumanProofRequest,
  ): Promise<boolean> {
    if (!INLINE_TURNSTILE_ACTIONS.has(requirement.action)) return false;
    const token = firstHeader(request, 'x-turnstile-token')?.trim();
    if (!token) return false;

    const verification = await this.turnstile.verify({
      token,
      remoteIp: resolveClientIp(request),
    });
    if (!verification.success) {
      recordHumanProofEvent('inline_verification_failed', requirement.action);
      throw new ForbiddenException({
        code: 'HUMAN_VERIFICATION_INVALID',
        message: 'Invalid or expired human verification',
      });
    }
    recordHumanProofEvent('inline_proof_consumed', requirement.action);
    return true;
  }

  private isRolloutBypassEnabled(requirement: HumanProofRequirement): boolean {
    if (requirement.enforcement !== 'public_customer_session') return false;

    const publicCustomerSession = this.config.get<PublicCustomerSessionConfig>(
      'publicCustomerSession',
    );
    return publicCustomerSession?.enforced === false;
  }
}

function firstHeader(
  req: Pick<HumanProofRequest, 'headers'>,
  name: string,
): string | undefined {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
