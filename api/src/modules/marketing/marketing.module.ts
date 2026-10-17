import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { SignupAttributionController } from './http/signup-attribution.controller';
import { SignupAttributionService } from './application/signup-attribution.service';
import { IAuthUserAttributionRepository } from './domain/auth-user-attribution.repository';
import { TypeOrmAuthUserAttributionRepository } from './infra/typeorm-auth-user-attribution.repository';

@Module({
  imports: [AuthModule],
  controllers: [SignupAttributionController],
  providers: [
    SignupAttributionService,
    {
      provide: IAuthUserAttributionRepository,
      useClass: TypeOrmAuthUserAttributionRepository,
    },
  ],
})
export class MarketingModule {}
