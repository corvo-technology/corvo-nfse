import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from '@/modules/email/email.module';
import { OtpChallengeService } from './application/otp-challenge.service';
import { OtpDeliveryGateway } from './application/otp-delivery.gateway';
import { OtpFlowService } from './application/otp-flow.service';
import { OtpVerificationProofService } from './application/otp-verification-proof.service';
import {
  AuthenticatedOtpController,
  PublicOtpController,
} from './http/otp.controller';
import {
  OTP_CHALLENGE_STORE,
  RedisOtpChallengeStore,
} from './infra/redis-otp-challenge.store';
import { EmailOtpDeliveryAdapter } from './infra/email-otp-delivery.adapter';

@Module({
  imports: [ConfigModule, EmailModule],
  controllers: [PublicOtpController, AuthenticatedOtpController],
  providers: [
    RedisOtpChallengeStore,
    { provide: OTP_CHALLENGE_STORE, useExisting: RedisOtpChallengeStore },
    OtpChallengeService,
    OtpDeliveryGateway,
    OtpFlowService,
    OtpVerificationProofService,
    EmailOtpDeliveryAdapter,
  ],
  exports: [
    OtpChallengeService,
    OtpDeliveryGateway,
    OtpFlowService,
    OtpVerificationProofService,
  ],
})
export class OtpModule implements OnModuleInit {
  constructor(
    private readonly gateway: OtpDeliveryGateway,
    private readonly emailAdapter: EmailOtpDeliveryAdapter,
  ) {}

  onModuleInit() {
    this.gateway.register(this.emailAdapter);
  }
}
