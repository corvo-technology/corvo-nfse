import { Injectable } from '@nestjs/common';
import {
  OtpDeliveryUnavailableError,
  OtpVerificationFailedError,
} from '../domain/otp-errors';
import { normalizeOtpTarget } from '../domain/otp-normalize';
import type {
  IssueOtpInput,
  OtpChannel,
  OtpScopeInput,
  VerifyOtpInput,
} from '../domain/otp.types';
import { OtpChallengeService } from './otp-challenge.service';
import { OtpDeliveryGateway } from './otp-delivery.gateway';
import { OtpVerificationProofService } from './otp-verification-proof.service';
import { recordOtpEvent } from '../../observability/security.metrics';

@Injectable()
export class OtpFlowService {
  constructor(
    private readonly challenges: OtpChallengeService,
    private readonly delivery: OtpDeliveryGateway,
    private readonly proofs: OtpVerificationProofService,
  ) {}

  publicSubjectId(
    productKey: string,
    channel: OtpChannel,
    target: string,
  ): string {
    return `public:${productKey}:${channel}:${normalizeOtpTarget(channel, target)}`;
  }

  async request(input: IssueOtpInput) {
    const normalizedInput = {
      ...input,
      target: normalizeOtpTarget(input.channel, input.target),
    };
    if (!this.delivery.supports(normalizedInput.channel)) {
      recordOtpEvent(
        'delivery_unavailable',
        normalizedInput.channel,
        normalizedInput.purpose,
        normalizedInput.audience,
      );
      throw new OtpDeliveryUnavailableError(normalizedInput.channel);
    }
    const issued = await this.challenges.issue(normalizedInput);
    try {
      await this.delivery.send(normalizedInput.channel, {
        target: issued.normalizedTarget,
        code: issued.code,
        purpose: normalizedInput.purpose,
        expiresAt: issued.expiresAt,
        productKey: normalizedInput.productKey,
        tenantId: normalizedInput.tenantId,
        challengeId: issued.challengeId,
      });
      recordOtpEvent(
        'issued',
        normalizedInput.channel,
        normalizedInput.purpose,
        normalizedInput.audience,
      );
    } catch (error) {
      await this.challenges.revoke(issued.challengeId);
      recordOtpEvent(
        'delivery_failed',
        normalizedInput.channel,
        normalizedInput.purpose,
        normalizedInput.audience,
      );
      if (error instanceof OtpDeliveryUnavailableError) throw error;
      throw new OtpDeliveryUnavailableError(normalizedInput.channel);
    }
    return {
      challengeId: issued.challengeId,
      channel: issued.channel,
      targetMasked: issued.maskedTarget,
      expiresAt: issued.expiresAt,
      resendAvailableAt: issued.resendAvailableAt,
    };
  }

  async verify(input: VerifyOtpInput) {
    const result = await this.challenges.verify(input);
    if (!result.valid) {
      recordOtpEvent(
        'verification_rejected',
        input.channel,
        input.purpose,
        input.audience,
      );
      throw new OtpVerificationFailedError();
    }
    const proof = await this.proofs.create(this.scopeFrom(input));
    recordOtpEvent('verified', input.channel, input.purpose, input.audience);
    return { verificationToken: proof.token, expiresAt: proof.expiresAt };
  }

  private scopeFrom(input: VerifyOtpInput): OtpScopeInput {
    return {
      audience: input.audience,
      productKey: input.productKey,
      channel: input.channel,
      purpose: input.purpose,
      subjectId: input.subjectId,
      target: input.target,
      contextId: input.contextId,
    };
  }
}
