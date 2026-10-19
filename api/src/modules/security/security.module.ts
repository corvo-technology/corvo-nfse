import { CookiePolicyService } from '@/modules/auth/application/cookie-policy.service';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { TurnstileAttestationService } from './application/turnstile-attestation.service';
import { TurnstileVerificationService } from './application/turnstile-verification.service';
import { TurnstileController } from './http/turnstile.controller';

@Module({
  imports: [ConfigModule, AppRedisModule],
  controllers: [TurnstileController],
  providers: [
    TurnstileAttestationService,
    TurnstileVerificationService,
    CookiePolicyService,
  ],
  exports: [TurnstileAttestationService, TurnstileVerificationService],
})
export class SecurityModule {}
